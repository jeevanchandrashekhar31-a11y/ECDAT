const { scanSourceDirectory } = require('./backend/src/routes/../binary/source_scanner');
try {
  const result = scanSourceDirectory('./test_repo', { projectName: 'test_repo' });
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error(e);
}
