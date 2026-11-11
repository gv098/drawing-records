const fs=require('fs'),path=require('path'),os=require('os');
let playwright;try{playwright=require('playwright');}catch(error){const bundled=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');if(!fs.existsSync(bundled))throw Error('Install Playwright: npm install playwright; npx playwright install chromium');playwright=require(bundled);}
const edge=process.platform==='win32'?path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'):null;
module.exports={chromium:playwright.chromium,launchOptions:{headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:edge&&fs.existsSync(edge)?{executablePath:edge}:{})}};
