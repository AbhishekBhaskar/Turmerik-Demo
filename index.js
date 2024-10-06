import { OpenAI } from "openai";
import fetch from 'node-fetch';
import * as fs from 'fs';
// import * as csvjson from 'csvjson';
import toCSV from 'csvjson';
import * as jsonToCSV from 'json-2-csv';

const openai = new OpenAI(
    {
        // Add your openai api key here
        apiKey: ""
    }
);

// function to fetch clinical trial data
async function fetchTrialData() {
    let iterCount = 0;
    let responseList = [];
    let nextPageToken = null;

    // limiting to 10 iterations to cope with the model's token handling capacity
    while(iterCount <= 10) {
        try {
            let api = nextPageToken ? `https://clinicaltrials.gov/api/v2/studies?filter.overallStatus=RECRUITING&fields=EligibilityCriteria%7CNCTId%7CBriefTitle&countTotal=true&pageSize=30&pageToken=${nextPageToken}` :
                                        "https://clinicaltrials.gov/api/v2/studies?filter.overallStatus=RECRUITING&fields=EligibilityCriteria%7CNCTId%7CBriefTitle&countTotal=true&pageSize=30";

            const res = await fetch(api);
            const promise = res.json();
            const promiseRes = await promise;
            nextPageToken = promiseRes.nextPageToken;
            responseList.push(promise);
            iterCount++;
        } catch (err) {
            console.error(`Error fetching api response: ${err}`);
        }
    }
    return responseList;
}


// function to fetch patient data
async function fetchPatientData() {
    let patietDataList = [];
    const promise = new Promise((resolve, reject) => {

        // read directory contents
        fs.readdir("./dataset/synthea_sample_data_fhir_latest", (err, files) => {
            if (err) {
                console.error('Error reading directory:', err);
                return;
            }
            
            // read patient data from dataset files
            files.forEach((file) => {
                let jsonFile = fs.readFileSync(`./dataset/synthea_sample_data_fhir_latest/${file}`);
                let patientData = JSON.parse(jsonFile);
                let filteredData = {};
                let patientResource = patientData["entry"].filter((item) => item["resource"]["resourceType"] == "Patient")[0];
                if (patientResource) {
                    filteredData["patientId"] = patientResource["resource"]["id"];
                    filteredData["birthDate"] = patientResource["resource"]["birthDate"];
                    filteredData["gender"] = patientResource["resource"]["gender"];
                    filteredData["name"] = patientResource["resource"]["name"];
                }
                let conditionsList = patientData["entry"].filter((item) => (item["resource"]["resourceType"] == "Condition"));
                filteredData['conditionsList'] = conditionsList;
                let medicationList = patientData["entry"].filter((item) => (item["resource"]["resourceType"] == "Medication"));
                filteredData['medicationList'] = medicationList;
                patietDataList.push(filteredData);
            })
            resolve(patietDataList);
        })
    })
    let res = await promise;
    return res;
}


// function to summarize and extract relavent patient info using LLM model
async function extractPatientFeatures(patientData) {
    let prompt = `You are a medical assistant. For each patient in the following json data, extract the following patient details from the text:
    - patient Id (Fetch entire uuid directly from the data)
    - patient Name (Use the given name)
    - Age (Calculate the age from the birthdate)
    - Gender
    - Medical conditions (diagnoses)
    - Medications

    Patient information: 
    `;

    for (let patient of patientData) {
        prompt += `${patient} \n\n`
    }
    prompt += `Please respond with a structured JSON format containing these fields: patientId, name, age, gender, conditions, medications.`

    let openAiResponse = openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        response_format: {
            "type": "json_object"
        },
        messages: [
            {"role": "system", "content": "You are a medical assistant extracting structured patient information. You always return just the JSON with no additional description or context."},
            {"role": "user", "content": prompt}
        ]
    })

    return openAiResponse;
}


// function to extract relavent clinical trial info using LLM model
async function extractEligibilityFeatures(trialData) {
    let prompt = `You are a medical assistant. For each clinical trial in the following json data, extract the following clinical trial information from the text:
    - nctId
    - briefTitle
    - Age range
    - Inclusion criteria
    - Exclusion criteria (if any)

    Clinical Trial data:
    `;

    let studiesList = [];
    for (let trialPromise of trialData) {
        const trial = await trialPromise;
        studiesList.push(...trial["studies"]);
        if (studiesList.length > 1) {
            break;
        }
    }

    for (let study of studiesList) {
        prompt += `Trial Id: ${study.protocolSection.identificationModule.nctId}\n`;
        prompt += `Trial Name: ${study.protocolSection.identificationModule.briefTitle}\n`;
        prompt += `EligibilityCriteria: ${study.protocolSection.eligibilityModule.eligibilityCriteria}\n\n`;
    }
    prompt += `Please respond with a structured JSON format containing these fields: trialId, trialName, ageRange, inclusionCriteria, exclusionCriteria.`
    let openAiResponse = openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        response_format: {
            "type": "json_object"
        },
        messages: [
            {"role": "system", "content": "You are a medical assistant extracting structured clinical trial information from the clinicaltrials.gov website data. You always return just the JSON with no additional description or context."},
            {"role": "user", "content": prompt}
        ]
    })

    return openAiResponse;

}

// function to match patient info to clinical trials based on eligibility criteria
async function matchPatientToTrial(patientData, trialData) {
    let prompt = `You are a medical assistant. For the following patient, determine if he qualifies for the clinical trial based on the inclusion and exclusion criteria.
    
    Patient Information:\n`;
    prompt += JSON.stringify(patientData);
    prompt += '\n\n';

    prompt += `Clinical Trial Data:\n`;
    prompt += JSON.stringify(trialData);
    
    prompt += '\n\n'

    prompt += `Respond with a structured JSON format containing these fields:
    - trialId (trialId)
    - match (true if the patient matches the clinical trial else false)
    - eligibilityCriteriaMet (eligibility criteria met)
    `;

    let openAiResponse = openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
            {"role": "system", "content": "You are a medical assistant helping to match patients to clinical trials."},
            {"role": "user", "content": prompt}
        ],
        response_format: {
            "type": "json_object"
        }
    })

    return openAiResponse;
}

async function consolidateData() {
    const [patientData, trialData] = await Promise.all([
        fetchPatientData(),
        fetchTrialData()
    ]);
    return {
        patientData,
        trialData
    }
}

consolidateData().then(async (data) => {
    let firstTenPatientsData = (data.patientData).slice(0, 11);
    let patientAIResponse = await extractPatientFeatures(firstTenPatientsData);
    let trialAPIResponse = await extractEligibilityFeatures(data.trialData);

    let patientData = JSON.parse(patientAIResponse.choices[0].message.content);
    let trialData = JSON.parse(trialAPIResponse.choices[0].message.content);
    
    let matchData = {};
    for (let patient of patientData["patients"]) {

        if (!matchData[patient['name']]) {
            matchData[patient['name']] = {};
        }

        // match clinical trial data to each patient
        for (let trial of trialData["clinicalTrials"]) {
            let matchAPIResponse = await matchPatientToTrial(patient, trial);
            matchData[patient['name']][trial['trialName']] = matchAPIResponse.choices[0].message.content;
        }

    }
    console.log("matchData");
    console.log(matchData);

    let resData = [];
    for (let key of Object.keys(matchData)) {
        let eligibleTrials = [];  
        for (let test of Object.keys(matchData[key])) {
            let data = JSON.parse(matchData[key][test]);
            if (data['match'] == true) {
                eligibleTrials.push({
                    trialId: data['trialId'],
                    trialName: test,
                    eligibilityCriteriaMet: data['eligibilityCriteriaMet']
                })
            }
        }
        resData.push({
            patientName: key,
            eligibleTrials
        })
    }

    // write output to file
    fs.writeFile('./Output.json', JSON.stringify(matchData), err => {
        if (err) {
            console.error(err);
        }
    })

    fs.writeFile('./EligibleTrials.json', JSON.stringify(resData), err => {
        if (err) {
            console.error(err);
        }
    })


    let csvData = jsonToCSV.json2csv(resData)

    fs.writeFile('./EligibleTrials.csv', csvData, 'utf-8', (err) => {
        if (err) {
            console.error(err);
            return;
        }
    })

    
})




