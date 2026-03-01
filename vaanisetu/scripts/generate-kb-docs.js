const fs = require('fs');
const path = require('path');

const schemes = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../data/schemes/central-schemes.json'), 'utf-8')
);
const jobs = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../data/jobs/sample-jobs.json'), 'utf-8')
);

const outDir = '/tmp/vaanisetu-kb';
fs.mkdirSync(outDir, { recursive: true });

// One rich text file per scheme
schemes.forEach((s) => {
    const doc = `GOVERNMENT SCHEME: ${s.name_en}
Hindi: ${s.name_hi || s.name_en}
ID: ${s.scheme_id}
Category: ${s.category}
Ministry: ${s.ministry || 'Government of India'}

DESCRIPTION:
${s.description}

WHO IS ELIGIBLE:
${JSON.stringify(s.eligibility_criteria, null, 2)}

BENEFIT: Up to Rs ${(s.benefit_amount_max || 0).toLocaleString('en-IN')} per year

REQUIRED DOCUMENTS:
${(s.required_documents || ['Aadhaar', 'Bank Passbook']).join(', ')}

HOW TO APPLY: ${s.how_to_apply || 'Visit your nearest Common Service Center (CSC) or apply online.'}

KEYWORDS: ${s.name_en} ${s.name_hi || ''} ${s.category} rural India government scheme benefit subsidy`.trim();

    fs.writeFileSync(path.join(outDir, `${s.scheme_id}.txt`), doc, 'utf-8');
});

// One summary file for all jobs
const jobsSummary = jobs.slice(0, 30).map(j =>
    `JOB: ${j.title} at ${j.company}
Location: ${j.district || ''}, ${j.state}
Type: ${j.job_type}
Salary: Rs ${j.salary_min || 0} - ${j.salary_max || 0} per month
Skills: ${Array.isArray(j.skills) ? j.skills.join(', ') : j.skills}
Description: ${j.description}`
).join('\n\n---\n\n');

fs.writeFileSync(path.join(outDir, 'jobs-catalog.txt'), jobsSummary, 'utf-8');

console.log(`Generated ${schemes.length + 1} KB documents in ${outDir}`);
