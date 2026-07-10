import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--window-size=1200,780'] });
const p = await b.newPage(); await p.setViewport({width:1200,height:780});
const errs=[]; p.on('pageerror',e=>errs.push('E '+e.message)); p.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404'))errs.push('C '+m.text());});
await p.goto('http://localhost:5180/', {waitUntil:'networkidle0', timeout:20000});
await new Promise(r=>setTimeout(r,1500));
await p.evaluate(()=>document.getElementById('overlay').classList.add('hidden'));
// drone oblique overview of the corn field + surroundings
await p.evaluate(()=>{ window.__dev.setScale('drone'); window.__dev.drone.group.position.set(0,42,70); window.__dev.camera.rotation.set(-0.45,0,0,'YXZ'); });
await new Promise(r=>setTimeout(r,2500)); await p.screenshot({path:'/tmp/corn_drone.png'});
// ground level looking out
await p.evaluate(()=>{ window.__dev.setScale('proximal'); const c=window.__dev.controller.object; c.position.set(30,1.7,20); c.rotation.set(-0.05,-0.7,0,'YXZ'); });
await new Promise(r=>setTimeout(r,1600)); await p.screenshot({path:'/tmp/corn_ground.png'});
console.log('errors:', errs.length); errs.slice(0,5).forEach(e=>console.log(e));
await b.close();
