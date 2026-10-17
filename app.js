/* IUFU — public homepage. Uses only Supabase's public publishable key. */
const SUPABASE_URL='https://cyelrzslfmwsiswbnuos.supabase.co';
const SUPABASE_KEY='sb_publishable_JEDNfKv0_iPhZNRXWyoWBA_JabQ-67L';
const fallback=[
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
].map(([title,youtube_id,category,featured])=>({title,youtube_id,category,featured,published:true}));
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const thumb=id=>`https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
const yt=id=>`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
const shortUrl=id=>`https://www.youtube.com/shorts/${encodeURIComponent(id)}`;
let allVideos=fallback;
function render(){
 const normal=allVideos.filter(v=>v.category!=='شورتس وريلز'&&v.youtube_id);
 const shorts=allVideos.filter(v=>v.category==='شورتس وريلز'&&v.youtube_id);
 const main=normal.find(v=>v.featured)||normal[0];
 document.querySelector('#featuredMain').innerHTML=main?`<a href="${yt(main.youtube_id)}" target="_blank" rel="noopener"><div class="featured-image"><img src="${thumb(main.youtube_id)}" alt="${safe(main.title)}" loading="lazy"><span class="play">▶</span></div><div class="featured-body"><span class="eyebrow">الحلقة المميزة</span><h3>${safe(main.title)}</h3><p>شاهد الحكاية كاملة على قناة صفحات من نور</p><span class="gold-btn">مشاهدة الحلقة ↗</span></div></a>`:'<p class="loading">لا توجد حلقات منشورة بعد.</p>';
 document.querySelector('#featuredSide').innerHTML=normal.filter(v=>v.youtube_id!==main?.youtube_id).slice(0,3).map(v=>`<a class="side-video" href="${yt(v.youtube_id)}" target="_blank" rel="noopener"><img src="${thumb(v.youtube_id)}" alt="" loading="lazy"><div><b>${safe(v.title)}</b><small>شاهد الحلقة ↗</small></div></a>`).join('');
 document.querySelector('#videosGrid').innerHTML=normal.slice(0,3).map(v=>`<a class="video-card" href="${yt(v.youtube_id)}" target="_blank" rel="noopener"><div class="thumb"><img src="${thumb(v.youtube_id)}" alt="${safe(v.title)}" loading="lazy"></div><h3>${safe(v.title)}</h3></a>`).join('');
 document.querySelector('#shortsGrid').innerHTML=shorts.slice(0,6).map(v=>`<a class="short-card" href="${shortUrl(v.youtube_id)}" target="_blank" rel="noopener" aria-label="${safe(v.title)}"><img src="${thumb(v.youtube_id)}" alt="${safe(v.title)}" loading="lazy"><div class="short-info"><span>▶ قصير</span><b>${safe(v.title)}</b></div></a>`).join('');
}
async function loadVideos(){try{const r=await fetch(`${SUPABASE_URL}/rest/v1/videos?select=title,youtube_id,category,featured,published&published=eq.true&order=created_at.asc`,{headers:{apikey:SUPABASE_KEY}});if(!r.ok)throw Error(`Supabase ${r.status}`);const data=await r.json();if(Array.isArray(data)&&data.length)allVideos=data; }catch(e){console.warn('Using cached public video list:',e.message)}render()}
const menu=document.querySelector('#menuToggle'),nav=document.querySelector('#navLinks');menu.addEventListener('click',()=>{const open=nav.classList.toggle('open');menu.setAttribute('aria-expanded',String(open))});nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{nav.classList.remove('open');menu.setAttribute('aria-expanded','false')}));
document.querySelector('#searchToggle').addEventListener('click',()=>{const bar=document.querySelector('#searchBar');bar.hidden=!bar.hidden;if(!bar.hidden)document.querySelector('#searchInput').focus()});
document.querySelector('#searchInput').addEventListener('input',e=>{const q=e.target.value.trim().toLocaleLowerCase('ar');document.querySelectorAll('.video-card,.short-card,.side-video').forEach(el=>{el.hidden=!!q&&!el.textContent.toLocaleLowerCase('ar').includes(q)})});
document.querySelectorAll('.chip').forEach(chip=>chip.addEventListener('click',()=>{document.querySelectorAll('.chip').forEach(c=>c.classList.remove('selected'));chip.classList.add('selected');const cat=chip.dataset.filter;document.querySelectorAll('.start-grid .story-card').forEach((card,i)=>{card.style.display=cat==='all'||(cat==='السيرة النبوية'&&i!==1)||(cat==='التاريخ الإسلامي'&&i===1)||(cat==='الصحابة'&&i===2)?'':'none'})}));
render();loadVideos();
