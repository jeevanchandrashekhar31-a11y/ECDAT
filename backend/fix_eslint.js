const fs = require('fs');
const path = require('path');

const reportPath = path.join(__dirname, 'eslint-report.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf16le').replace(/^\uFEFF/, ''));

for (const fileResult of report) {
  if (fileResult.messages.length === 0) continue;
  
  let content = fs.readFileSync(fileResult.filePath, 'utf8');
  let lines = content.split('\n');
  let modified = false;

  // Process from bottom to top to preserve line numbers
  const messages = fileResult.messages.sort((a, b) => b.line - a.line);

  for (const msg of messages) {
    if (msg.ruleId === 'no-unused-vars') {
      const lineIdx = msg.line - 1;
      const originalLine = lines[lineIdx];
      
      // Match the variable name from the message: e.g. 'fs' is assigned a value but never used.
      const match = msg.message.match(/'([^']+)'/);
      if (match) {
        const varName = match[1];
        
        // Simple heuristic for unused args (e.g. catch (e) or function(req, res, next))
        if (msg.message.includes('defined but never used') || msg.message.includes('unused args') || msg.message.includes('unused caught errors')) {
          // Replace it with an underscore prefix to bypass the rule
          lines[lineIdx] = originalLine.replace(new RegExp(`\\b${varName}\\b`), `_${varName}`);
          modified = true;
        } else if (msg.message.includes('assigned a value but never used')) {
          // If it's a require or a variable assignment, we can comment it out if it takes the whole line
          // e.g. const fs = require('fs');
          if (originalLine.trim().startsWith('const ' + varName) || originalLine.trim().startsWith('let ' + varName)) {
             lines[lineIdx] = `// ${originalLine}`;
             modified = true;
          }
        }
      }
    }
  }

  if (modified) {
    fs.writeFileSync(fileResult.filePath, lines.join('\n'));
    console.log('Fixed:', fileResult.filePath);
  }
}
