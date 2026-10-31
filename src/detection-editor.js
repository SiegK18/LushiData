import { validBox, validObjects } from './core.js';
// All mutable dataset state stays in app.js.
export function detectionThumbnail(frame) {
  const escape = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return '<div class="detection-thumbnail" style="aspect-ratio:'+(frame.width||640)+'/'+(frame.height||360)+'"><img loading="lazy" src="'+frame.data+'" alt="Image avec propositions de rectangles"><svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">'+(frame.objects||[]).map((o,i)=>'<rect x="'+o.box_2d[1]+'" y="'+o.box_2d[0]+'" width="'+(o.box_2d[3]-o.box_2d[1])+'" height="'+(o.box_2d[2]-o.box_2d[0])+'" class="thumb-box"/><text x="'+(o.box_2d[1]+8)+'" y="'+Math.min(980,o.box_2d[0]+40)+'">'+escape(i+1)+'</text>').join('')+'</svg></div>';
}
export function openDetectionEditor({frame:f,classes,source,index,total,onNavigate,onDirty,onApprove,onReject,onRestore}) {
  const get=id=>document.getElementById(id);
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  f.objects ||= [];
  const readonly=f.status==='filtered'; let selected=f.objects[0]?.id||null, drawing=false, gesture=null;
  const colours=['#7045d3','#087e77','#c77a17','#b14f7e','#416cc2'];
  get('frameDetail').innerHTML='<div class="detail-nav"><span>Image '+(index+1)+' sur '+total+'</span><div class="detail-nav-actions"><button id="previousFrame" aria-label="Image précédente"'+(index===0?' disabled':'')+'>←</button><button id="nextFrame" aria-label="Image suivante"'+(index===total-1?' disabled':'')+'>→</button></div></div>'+
    '<div class="detection-editor"><div class="detection-visual"><div class="detection-canvas" id="detectionCanvas"><img id="detectionImage" src="'+f.data+'" alt="Objets à annoter"><svg id="boxOverlay" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Rectangles de détection"><g id="boxShapes"></g><rect id="newBoxPreview" hidden class="new-box"/></svg></div><div class="drawing-tools"><button class="btn btn-white" id="drawBoxBtn" aria-pressed="false"'+(readonly?' disabled':'')+'>＋ Dessiner un rectangle</button><span id="drawingHint">Sélectionnez un rectangle pour le déplacer.</span></div><details class="frame-provenance"><summary>Source et contrôles qualité</summary><div class="evidence-row"><span>Source</span><span>'+escape(source?.name)+'</span></div><div class="evidence-row"><span>Position</span><span>'+f.time+' s</span></div><div class="evidence-row"><span>Dimensions</span><span>'+f.width+' × '+f.height+' px</span></div><div class="evidence-row"><span>Filtre initial</span><span>'+escape(f.filterReason||'Aucun')+'</span></div></details></div>'+
    '<div class="detection-info"><span class="eyebrow">PLUSIEURS OBJETS PAR IMAGE</span><h2 id="objectCountTitle"></h2><p>'+escape(f.prediction?.reason||'Gemma peut proposer des rectangles. Vous pouvez également les dessiner vous-même.')+'</p>'+(f.prediction?.incomplete?'<p class="detail-help">Gemma signale une scène potentiellement incomplète. Ajoutez les objets manquants avant de confirmer.</p>':'')+'<p class="object-instructions">Vérifiez chaque catégorie et chaque rectangle. Glissez un rectangle pour le déplacer, ou son coin pour le redimensionner.</p><div id="objectList" class="object-list"></div><div id="coordinateEditor" hidden></div><label class="check-label empty-confirm" id="emptyConfirmLabel"><input type="checkbox" id="confirmEmpty"> Je confirme qu’aucun objet de ces catégories n’est présent.</label>'+(f.prediction?.incomplete?'<label class="check-label"><input type="checkbox" id="confirmScene"> J’ai vérifié les objets et complété cette scène.</label>':'')+'<p id="objectError" class="field-error" role="alert" hidden></p><div class="detail-actions">'+(readonly?'<button class="btn btn-primary advance-button" id="restoreFrame">Récupérer pour vérification</button>':'<button class="btn btn-primary advance-button" id="approveNextFrame">✓ Valider les objets et suivante →</button><button class="btn btn-white" id="approveFrame">Valider et fermer</button>')+'<button class="btn btn-white" id="rejectFrame">Rejeter l’image</button></div><p class="keyboard-hint">Gemma propose jusqu’à 20 objets. Les rectangles restent des propositions à vérifier.</p></div></div>';
  const showError=text=>{get('objectError').textContent=text;get('objectError').hidden=false;};
  const dirty=()=>{f.emptyConfirmed=false;f.sceneConfirmed=false;f.status='pending';f.reviewedAt=null;get('objectError').hidden=true;onDirty();};
  const point=e=>{const b=get('boxOverlay').getBoundingClientRect();return [Math.max(0,Math.min(1000,(e.clientY-b.top)/b.height*1000)),Math.max(0,Math.min(1000,(e.clientX-b.left)/b.width*1000))];};
  function shapes(){
    get('boxShapes').innerHTML=f.objects.map((o,i)=>{const b=o.box_2d,active=o.id===selected, colour=colours[i%colours.length];return '<g data-object-id="'+escape(o.id)+'"><rect class="object-box'+(active?' selected':'')+'" style="--box-colour:'+colour+'" x="'+b[1]+'" y="'+b[0]+'" width="'+(b[3]-b[1])+'" height="'+(b[2]-b[0])+'"/><text x="'+(b[1]+6)+'" y="'+Math.min(985,b[0]+38)+'" style="fill:'+colour+'">'+(i+1)+'</text>'+(active&&!readonly?'<rect data-resize="true" class="resize-handle" x="'+(b[3]-25)+'" y="'+(b[2]-25)+'" width="50" height="50"/>':'')+'</g>';}).join('');
  }
  function coordinates(){
    const o=f.objects.find(o=>o.id===selected),panel=get('coordinateEditor');panel.hidden=!o||readonly;
    if(!o||readonly)return;
    const b=o.box_2d;
    panel.innerHTML='<div class="coordinate-title">Ajuster le rectangle sélectionné <span>% de l’image</span></div><div class="coordinate-fields">'+[['left','Gauche',b[1]/10],['top','Haut',b[0]/10],['width','Largeur',(b[3]-b[1])/10],['height','Hauteur',(b[2]-b[0])/10]].map(([id,label,n])=>'<label>'+label+'<input type="number" id="box_'+id+'" min="0" max="100" step="0.1" value="'+n.toFixed(1)+'"></label>').join('')+'</div>';
    for(const input of panel.querySelectorAll('input'))input.onchange=()=>{
      const left=Number(get('box_left').value)*10,top=Number(get('box_top').value)*10,w=Number(get('box_width').value)*10,h=Number(get('box_height').value)*10;
      const box=[top,left,top+h,left+w];
      if(!validBox(box)){showError('Le rectangle doit rester dans l’image, avec une largeur et une hauteur positives.');coordinates();return;}
      o.box_2d=box;dirty();shapes();
    };
  }
  function render(){
    get('objectCountTitle').textContent=f.objects.length+' objet'+(f.objects.length>1?'s':'')+' dans cette image';
    get('emptyConfirmLabel').hidden=f.objects.length>0||readonly;get('confirmEmpty').checked=!!f.emptyConfirmed;
    get('objectList').innerHTML=f.objects.length?f.objects.map((o,i)=>'<div class="object-row'+(o.id===selected?' active':'')+'" data-row="'+escape(o.id)+'"><button class="object-select" data-select="'+escape(o.id)+'" aria-label="Sélectionner l’objet '+(i+1)+'"><span style="background:'+colours[i%colours.length]+'">'+(i+1)+'</span></button><div><label class="sr-only" for="objectLabel_'+i+'">Catégorie de l’objet '+(i+1)+'</label><select id="objectLabel_'+i+'" data-label="'+escape(o.id)+'"'+(readonly?' disabled':'')+'>'+[...classes,'indéterminé'].map(c=>'<option value="'+escape(c)+'"'+(c===o.label?' selected':'')+'>'+escape(c)+'</option>').join('')+'</select>'+(o.uncertain?'<small>Catégorie à vérifier</small>':'')+'</div><button class="object-delete" data-delete="'+escape(o.id)+'" aria-label="Supprimer l’objet '+(i+1)+'"'+(readonly?' disabled':'')+'>×</button></div>').join(''):'<div class="no-objects">Aucun rectangle pour le moment. Lancez Gemma ou dessinez les objets visibles.</div>';
    for(const button of get('objectList').querySelectorAll('[data-select]'))button.onclick=()=>{selected=button.dataset.select;render();};
    for(const select of get('objectList').querySelectorAll('[data-label]'))select.onchange=()=>{const o=f.objects.find(o=>o.id===select.dataset.label);o.label=select.value;o.uncertain=select.value==='indéterminé';selected=o.id;dirty();render();};
    for(const button of get('objectList').querySelectorAll('[data-delete]'))button.onclick=()=>{f.objects=f.objects.filter(o=>o.id!==button.dataset.delete);selected=f.objects[0]?.id||null;dirty();render();};
    shapes();coordinates();
  }
  get('drawBoxBtn').onclick=()=>{drawing=!drawing;get('drawBoxBtn').setAttribute('aria-pressed',String(drawing));get('drawBoxBtn').classList.toggle('drawing',drawing);get('drawingHint').textContent=drawing?'Glissez sur l’image pour dessiner.':'Sélectionnez un rectangle pour le déplacer.';get('detectionCanvas').classList.toggle('drawing',drawing);};
  const svg=get('boxOverlay');
  svg.onpointerdown=e=>{
    if(readonly)return;
    const p=point(e),target=e.target.closest('[data-object-id]');
    if(drawing){if(f.objects.length>=50)return showError('Maximum 50 objets par image.');gesture={type:'draw',start:p};}
    else if(target){selected=target.dataset.objectId;const o=f.objects.find(o=>o.id===selected);gesture={type:e.target.hasAttribute('data-resize')?'resize':'move',start:p,box:[...o.box_2d],object:o};render();}else return;
    e.preventDefault();svg.setPointerCapture(e.pointerId);
  };
  svg.onpointermove=e=>{
    if(!gesture)return;const p=point(e),dy=p[0]-gesture.start[0],dx=p[1]-gesture.start[1];
    if(gesture.type==='draw'){const r=get('newBoxPreview'),b=[Math.min(p[0],gesture.start[0]),Math.min(p[1],gesture.start[1]),Math.max(p[0],gesture.start[0]),Math.max(p[1],gesture.start[1])];r.removeAttribute('hidden');for(const [k,v] of Object.entries({x:b[1],y:b[0],width:b[3]-b[1],height:b[2]-b[0]}))r.setAttribute(k,v);}
    else{const b=gesture.box;if(gesture.type==='move'){const x=Math.max(-b[1],Math.min(1000-b[3],dx)),y=Math.max(-b[0],Math.min(1000-b[2],dy));gesture.object.box_2d=[b[0]+y,b[1]+x,b[2]+y,b[3]+x];}else gesture.object.box_2d=[b[0],b[1],Math.max(b[0]+5,Math.min(1000,b[2]+dy)),Math.max(b[1]+5,Math.min(1000,b[3]+dx))];if(!gesture.changed&&(Math.abs(dx)>1||Math.abs(dy)>1)){gesture.changed=true;dirty();}shapes();}
  };
  function finishPointer(e,cancel=false){
    if(!gesture)return;const g=gesture;gesture=null;get('newBoxPreview').setAttribute('hidden','');
    if(cancel){if(g.object)g.object.box_2d=g.box;render();return;}
    const p=point(e);
    if(g.type==='draw'){const b=[Math.min(p[0],g.start[0]),Math.min(p[1],g.start[1]),Math.max(p[0],g.start[0]),Math.max(p[1],g.start[1])];if(b[2]-b[0]<5||b[3]-b[1]<5)return showError('Dessinez un rectangle plus grand.');const o={id:'manual_'+crypto.randomUUID().slice(0,8),label:'indéterminé',box_2d:b,uncertain:true,reason:'Rectangle ajouté manuellement.'};f.objects.push(o);selected=o.id;drawing=false;get('drawBoxBtn').setAttribute('aria-pressed','false');get('drawBoxBtn').classList.remove('drawing');get('detectionCanvas').classList.remove('drawing');}
    if(g.type==='draw'||JSON.stringify(g.box)!==JSON.stringify(g.object.box_2d))dirty();render();
  }
  svg.onpointerup=e=>finishPointer(e);svg.onpointercancel=e=>finishPointer(e,true);
  const approve=advance=>{
    if(!validObjects(f.objects,classes))return showError('Corrigez les catégories indéterminées et les rectangles invalides, ou supprimez les objets concernés.');
    if(!f.objects.length&&!get('confirmEmpty').checked)return showError('Confirmez explicitement l’absence d’objets ou dessinez les objets manquants.');
    if(get('confirmScene')&&!get('confirmScene').checked)return showError('Vérifiez et confirmez la scène signalée incomplète avant de la valider.');
    f.emptyConfirmed=!f.objects.length&&get('confirmEmpty').checked;f.sceneConfirmed=true;onApprove(advance);
  };
  if(get('approveFrame'))get('approveFrame').onclick=()=>approve(false);
  if(get('approveNextFrame'))get('approveNextFrame').onclick=()=>approve(true);
  if(get('restoreFrame'))get('restoreFrame').onclick=onRestore;
  get('confirmEmpty').onchange=dirty;
  if(get('confirmScene')){get('confirmScene').checked=!!f.sceneConfirmed;get('confirmScene').onchange=dirty;}
  get('rejectFrame').onclick=onReject;
  get('previousFrame').onclick=()=>onNavigate(index-1);get('nextFrame').onclick=()=>onNavigate(index+1);
  render();
}
