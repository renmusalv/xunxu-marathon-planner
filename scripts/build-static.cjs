const fs = require('node:fs');
const path = require('node:path');
fs.mkdirSync('dist', {recursive:true});
fs.copyFileSync('index.html','dist/index.html');
fs.writeFileSync('dist/.nojekyll', '');
for(const name of ['app.js','assessment.js','target-plan.js','session-advice.js','profile-store.js','ocr.js','enhancements.css']) fs.copyFileSync(path.join('src',name),path.join('dist',name));
for(const name of ['tesseract.min.js','worker.min.js']) if(!fs.existsSync(path.join('dist/vendor/ocr',name))) throw new Error('Missing OCR asset '+name);
console.log('Built static planner with profile-scoped records, assessment and local OCR.');
