import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--window-size=1280,800'] });
const page = await browser.newPage(); await page.setViewport({ width:1280, height:800 });
const errors=[]; page.on('pageerror',e=>errors.push('PAGEERROR: '+e.message)); page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404'))errors.push('CONSOLE: '+m.text());});
await page.goto('http://localhost:5173/', { waitUntil:'networkidle0', timeout:15000 });
await page.evaluate(() => { document.getElementById('overlay').classList.add('hidden'); document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF'})); });
await new Promise(r=>setTimeout(r,1700));
// drone over home field, oblique
await page.evaluate(()=>{window.__dev.setScale('drone'); window.__dev.drone.group.position.set(0,38,28); window.__dev.camera.rotation.set(-0.32,0,0,'YXZ');});
await new Promise(r=>setTimeout(r,1000)); await page.screenshot({path:'/tmp/spot-oblique.png'});
// higher overview
await page.evaluate(()=>{window.__dev.drone.group.position.set(0,75,55); window.__dev.camera.rotation.set(-0.3,0,0,'YXZ');});
await new Promise(r=>setTimeout(r,900)); await page.screenshot({path:'/tmp/spot-high.png'});
// near-top-down
await page.evaluate(()=>{window.__dev.drone.group.position.set(0,60,10); window.__dev.camera.rotation.set(-1.1,0,0,'YXZ');});
await new Promise(r=>setTimeout(r,800)); await page.screenshot({path:'/tmp/spot-top.png'});
console.log('errors:', errors.length); errors.slice(0,5).forEach(e=>console.log(e));
await browser.close();
