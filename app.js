/* IUFU — public video catalogue; all video playback remains on the website. */
const URL='https://cyelrzslfmwsiswbnuos.supabase.co';
const KEY='sb_publishable_JEDNfKv0_iPhZNRXWyoWBA_JabQ-67L';
const initial=[
['صفوان بن أمية — يوم فتح مكة','Xq8omR68XPA','السيرة النبوية',true],
['معركة بدر','qwNZ_8YtVUA','السيرة النبوية',false],
['أخطر 3 مهمات سرية','GmWqe-_BOFE','السيرة النبوية',false],
['عبد الله بن حذافة','0fimFI2HYzE','الصحابة',false],
['جاء ليغدر بالنبي ﷺ فأخبره الله بسرّه','0NCZu4O77Fg','شورتس وريلز',false],
['الخيل والراية الصفراء','O80YNITO8OU','شورتس وريلز',false],
['القلادة ذات الحجر الأحمر','wRCcBIzzn8g','شورتس وريلز',false],
['مواجهة عند الجمل','k8i895dWeWo','شورتس وريلز',false],
['تجمع كبير','GpO2EkL3w78','شورتس وريلز',false],
['المحارب الجالس','Fxjy3lOaZPA','شورتس وريلز',false]
].map(([title,youtube_id,category,featured])=>({title,youtube_id,category,featured}));
let videos=initial;
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const valid=id=>/^[A-Za-z0-9_-]{11}$/.test(id||'');
const thumbnail=id=>`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
const image=(v)=>`<img src="${thumbnail(v.youtube_id)}" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${v.youtube_id}/hqdefault.jpg'" loading="lazy" alt="${safe(v.title)}">`;
const clickAttrs=v=>`role="button" tabindex="0" data-video="${v.youtube_id}" data-title="${safe(v.title)}" aria-label="شاهد ${safe(v.title)}"`;
function render(){
 const regular=videos.filter(v=>valid(v.youtube_id)&&v.category!=='شورتس وريلز');
 const shorts=videos.filter(v=>valid(v.youtube_id)&&v.category==='شورتس وريلز');
 const main=regular.find(v=>v.featured)||regular[0];
 document.querySelector('#featureMain').innerHTML=main?`<div class="feature-visual" ${clickAttrs(main)}>${image(main)}<span class="play-button">▶</span></div><div class="feature-info"><span class="overline">الحلقة المميزة</span><h3>${safe(main.title)}</h3><p>حكاية من السيرة والتاريخ الإسلامي، شاهدها هنا دون مغادرة الموقع.</p><button class="gold-button" ${clickAttrs(main)}>مشاهدة الآن</button></div>`:'';
 document.querySelector('#featureSide').innerHTML=regular.filter(v=>v.youtube_id!==main?.youtube_id).slice(0,3).map(v=>`<div class="side-video" ${clickAttrs(v)}>${image(v)}<div><strong>${safe(v.title)}</strong><small>شاهد الحلقة ←</small></div></div>`).join('');
 document.querySelector('#videosGrid').innerHTML=regular.filter(v=>v.youtube_id!==main?.youtube_id).slice(0,3).map(v=>`<article class="video-tile" ${clickAttrs(v)}><div class="thumb">${image(v)}<span class="play-button">▶</span></div><h3>${safe(v.title)}</h3></article>`).join('');
 document.querySelector('#shortsGrid').innerHTML=shorts.slice(0,6).map(v=>`<article class="short-tile" ${clickAttrs(v)}>${image(v)}<div class="short-copy"><span>▷ قصير</span>${safe(v.title)}</div></article>`).join('');
}
const modal=document.querySelector('#playerModal');
function play(id,title){
 if(!valid(id))return;
 document.querySelector('#modalTitle').textContent=title||'مشاهدة الفيديو';
 document.querySelector('#playerFrame').innerHTML=`<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&playsinline=1" title="${safe(title)}" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture;web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
 document.querySelector('#youtubeFallback').href=`https://www.youtube.com/watch?v=${id}`;
 modal.hidden=false;document.body.style.overflow='hidden';
}
function close(){modal.hidden=true;document.querySelector('#playerFrame').innerHTML='';document.body.style.overflow=''}
document.addEventListener('click',e=>{const el=e.target.closest('[data-video]');if(el){play(el.dataset.video,el.dataset.title);return}if(e.target.closest('[data-close]')||e.target.closest('#closePlayer'))close()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')close();if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-video]')){e.preventDefault();play(e.target.dataset.video,e.target.dataset.title)}});
document.querySelector('#menuBtn').addEventListener('click',()=>{const nav=document.querySelector('#nav');const isOpen=nav.classList.toggle('open');document.querySelector('#menuBtn').setAttribute('aria-expanded',String(isOpen))});
document.querySelectorAll('#nav a').forEach(a=>a.addEventListener('click',()=>document.querySelector('#nav').classList.remove('open')));
document.querySelector('#searchBtn').addEventListener('click',()=>{const el=document.querySelector('#searchbox');el.hidden=!el.hidden;if(!el.hidden)document.querySelector('#search').focus()});
document.querySelector('#search').addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();document.querySelectorAll('[data-video]').forEach(el=>{if(!el.closest('[data-video]')?.parentElement)return;el.style.display=!q||el.dataset.title.toLowerCase().includes(q)?'':'none'})});
async function refresh(){try{const r=await fetch(`${URL}/rest/v1/videos?select=title,youtube_id,category,featured&published=eq.true&order=created_at.asc`,{headers:{apikey:KEY}});if(!r.ok)throw new Error('HTTP '+r.status);const result=await r.json();if(Array.isArray(result)&&result.length)videos=result.filter(v=>valid(v.youtube_id));render()}catch(err){console.info('Showing locally bundled catalogue',err.message)}}
render();refresh();
