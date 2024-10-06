## Project to match patients to eligible clinical trials

### Steps to run the project
* Run the command `npm install` to install dependencies
* If OpenAI api key is available, replace the existing one with the new one under the comment // Add your openai api key here
* Run the code using the command `node index.js`
* It will take some time for the output to get generated as the LLM model needs to summarize and match patient details with clinical trial data
* There are 2 output json files that get generated. One is EligibleTrials.json which has the list of all patients with their eligible trials. The other is Output.json which is the raw output of the algorithm and it contains all the trials of the patients indicating if they are a match or no-match
* The FHIR R4 100 sample synthetic patient records dataset is used for patient info
* The `https://clinicaltrials.gov/api/v2/studies` api is used to fetch clinical trial data along with `filter.overallStatus=RECRUITING` query parameter to fetch trials that are only actively recruiting

### Notes
* The OpenAI chat completions api is used to summarize patient info and extract eligibility criteria from the clinical trial data
* GPT model `gpt-3.5-turbo` is used for the api
