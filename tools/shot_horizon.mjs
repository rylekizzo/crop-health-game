import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--window-size=1200,780'] });
const p = await b.newPage(); await p.setViewport({width:1200,height:780});
await p.goto('http://localhost:5180/', {waitUntil:'networkidle0', timeout:20000});
await new Promise(r=>setTimeout(r,1500));
await p.evaluate(()=>document.getElementById('overlay').classList.add('hidden'));
// higher drone, looking out toward the horizon to see fields + sky + sun
await p.evaluate(()=>{ window.__dev.setScale('drone'); window.__dev.drone.group.position.set(0,55,40); window.__dev.camera.rotation.set(-0.16,0,0,'YXZ'); });
await new Promise(r=>setTimeout(r,2500)); await p.screenshot({path:'/tmp/corn_horizon.png'});
await b.close();
