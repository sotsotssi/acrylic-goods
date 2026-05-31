// UI 상수 & 유틸
const CANVAS_SIZE = 800;
const canvasEl = document.getElementById('main-canvas');
const overlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

// --- Three.js & Cannon.js 글로벌 설정 ---
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, preserveDrawingBuffer: true, alpha: true, logarithmicDepthBuffer: true });
renderer.setSize(CANVAS_SIZE, CANVAS_SIZE, false);
renderer.autoClear = false;

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
camera.position.set(0, 200, 600);
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); scene.add(ambientLight);
const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.5); dirLight1.position.set(200, 300, 200); scene.add(dirLight1);
const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3); dirLight2.position.set(-200, 100, -200); scene.add(dirLight2);

// UI 오버레이 씬 (워터마크 등)
const uiScene = new THREE.Scene();
const uiCamera = new THREE.OrthographicCamera(-CANVAS_SIZE/2, CANVAS_SIZE/2, CANVAS_SIZE/2, -CANVAS_SIZE/2, 1, 10);
uiCamera.position.z = 5;
let wmSprite = null, wmTexture = null;

// 물리 엔진 (Cannon.js)
let physicsWorld = null;
let physicsObjects = [];

// 전역 굿즈 데이터 보관소
let currentTab = 'stand'; // 'stand' | 'shaker' | 'diorama'
let pivotContainer = null;

// [스탠드 데이터]
let standImgFront = null, standImgBack = null, standImgBase = null;

// [쉐이커 데이터]
let shakerBgImg = null, shakerFrontImg = null;
let shakerParts = []; // { id, img, qty, scale }
let shakerPartIdCounter = 0;

// [디오라마 데이터]
let dioramaLayers = []; // { id, img, offsetX, offsetY, groupRef }
let dioramaLayerIdCounter = 0;

// --- 유틸 함수 ---
function showLoading(text) { loadingText.innerHTML = text; overlay.style.display = 'flex'; }
function hideLoading() { overlay.style.display = 'none'; }
function fileToImage(file, callback) {
    if(!file) return callback(null);
    const reader = new FileReader();
    reader.onload = e => { const img = new Image(); img.onload = () => callback(img); img.src = e.target.result; };
    reader.readAsDataURL(file);
}

// --- 공통 UI 이벤트 처리 ---
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        const targetId = e.target.getAttribute('data-target');
        document.getElementById(targetId).classList.add('active');
        currentTab = targetId.replace('tab-', '');
    });
});

document.querySelectorAll('.btn-clear').forEach(btn => {
    btn.addEventListener('click', e => {
        const targetId = e.target.getAttribute('data-target');
        document.getElementById(targetId).value = '';
        if(targetId === 'standBackInput') standImgBack = null;
        if(targetId === 'standBaseInput') standImgBase = null;
    });
});

['thickness', 'margin', 'baseSize', 'shakerAreaRatio', 'dioramaBaseMargin', 'dioramaGap', 'shakerBgSize'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.addEventListener('input', e => document.getElementById('val' + id.charAt(0).toUpperCase() + id.slice(1)).textContent = e.target.value);
});

document.getElementById('pivotType').addEventListener('change', e => {
    document.getElementById('baseOptionsPanel').style.display = e.target.value === 'bottom' ? 'block' : 'none';
});
document.getElementById('baseShapeType').addEventListener('change', e => {
    document.getElementById('baseSizeContainer').style.display = e.target.value === 'contour' ? 'none' : 'block';
});
document.getElementById('shakerBgType').addEventListener('change', e => {
    const type = e.target.value;
    document.getElementById('shakerBgImageUploadWrap').style.display = type === 'image' ? 'flex' : 'none';
    document.getElementById('shakerBgSizeWrap').style.display = type !== 'image' ? 'flex' : 'none';
});

// 배경/투명도
function updateBackground() {
    const isTransparent = document.getElementById('bgTransparent').checked;
    const color = document.getElementById('bgColor').value;
    if (isTransparent) { scene.background = null; renderer.setClearColor(0x000000, 0); canvasEl.classList.add('bg-checker'); canvasEl.style.backgroundColor = 'transparent'; } 
    else { scene.background = new THREE.Color(color); renderer.setClearColor(color, 1); canvasEl.classList.remove('bg-checker'); canvasEl.style.backgroundColor = color; }
    
    let isLight = true;
    if (!isTransparent) { const r = parseInt(color.slice(1,3),16), g = parseInt(color.slice(3,5),16), b = parseInt(color.slice(5,7),16); isLight = (r*299 + g*587 + b*114)/1000 > 128; }
    const cvs = document.createElement('canvas'); cvs.width = 400; cvs.height = 60;
    const ctx = cvs.getContext('2d'); ctx.fillStyle = isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'right'; ctx.fillText('사이버 아크릴 굿즈 공방 @bb_uu_t', 390, 35);
    if (!wmSprite) { wmTexture = new THREE.CanvasTexture(cvs); wmSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: wmTexture, transparent: true })); wmSprite.scale.set(400, 60, 1); wmSprite.position.set(CANVAS_SIZE/2 - 210, -CANVAS_SIZE/2 + 40, 0); uiScene.add(wmSprite); } 
    else { wmTexture.image = cvs; wmTexture.needsUpdate = true; }
}
document.getElementById('bgTransparent').addEventListener('change', updateBackground);
document.getElementById('bgColor').addEventListener('input', updateBackground);
updateBackground();

// 조명 컨트롤
const lightPad = document.getElementById('lightControlPad'); const lightHandle = document.getElementById('lightHandle');
let isDraggingLight = false;
function updateLightPosition(e) {
    const rect = lightPad.getBoundingClientRect(); let cx = e.clientX || e.touches[0].clientX, cy = e.clientY || e.touches[0].clientY;
    let dx = cx - rect.left - rect.width/2, dy = cy - rect.top - rect.height/2;
    const dist = Math.sqrt(dx*dx + dy*dy); if (dist > 33) { dx = (dx/dist)*33; dy = (dy/dist)*33; }
    lightHandle.style.left = `calc(50% + ${dx}px)`; lightHandle.style.top = `calc(50% + ${dy}px)`;
    dirLight1.position.x = dx * (400/33); dirLight1.position.z = dy * (400/33);
}
lightPad.addEventListener('mousedown', e => { isDraggingLight = true; updateLightPosition(e); });
window.addEventListener('mousemove', e => { if (isDraggingLight) updateLightPosition(e); }); window.addEventListener('mouseup', () => isDraggingLight = false);
lightPad.addEventListener('touchstart', e => { isDraggingLight = true; updateLightPosition(e); }, {passive:true});
window.addEventListener('touchmove', e => { if (isDraggingLight) { updateLightPosition(e); e.preventDefault(); } }, {passive:false}); window.addEventListener('touchend', () => isDraggingLight = false);
document.getElementById('lightIntensity').addEventListener('input', e => dirLight1.intensity = parseFloat(e.target.value));
document.getElementById('ambientIntensity').addEventListener('input', e => ambientLight.intensity = parseFloat(e.target.value));
document.getElementById('btnResetLight').addEventListener('click', () => { dirLight1.position.set(200,300,200); dirLight1.intensity = 0.5; ambientLight.intensity = 0.6; document.getElementById('lightIntensity').value = 0.5; document.getElementById('ambientIntensity').value = 0.6; lightHandle.style.left='calc(50% + 16.5px)'; lightHandle.style.top='calc(50% + 16.5px)'; });

// 입력 필드 이미지 바인딩
document.getElementById('standFrontInput').addEventListener('change', e => fileToImage(e.target.files[0], img => standImgFront = img));
document.getElementById('standBackInput').addEventListener('change', e => fileToImage(e.target.files[0], img => standImgBack = img));
document.getElementById('standBaseInput').addEventListener('change', e => fileToImage(e.target.files[0], img => standImgBase = img));
document.getElementById('shakerBgInput').addEventListener('change', e => fileToImage(e.target.files[0], img => shakerBgImg = img));

// --- 드래그 앤 드롭 유틸리티 (핸들만 사용) ---
let draggedItemIndex = null;
function handleDragStart(e, index) { draggedItemIndex = index; e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('dragging'); }
function handleDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function handleDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
function handleDragEnd(e) { e.currentTarget.classList.remove('dragging'); }
function handleDrop(e, targetIndex, arrayToUpdate, renderFn) {
    e.preventDefault(); e.currentTarget.classList.remove('drag-over');
    if (draggedItemIndex !== null && draggedItemIndex !== targetIndex) {
        const item = arrayToUpdate.splice(draggedItemIndex, 1)[0];
        arrayToUpdate.splice(targetIndex, 0, item);
        renderFn();
    }
}

// --- 동적 리스트 UI 추가 (Shaker) ---
function renderShakerPartsUI() {
    const list = document.getElementById('shaker-parts-list'); list.innerHTML = '';
    shakerParts.forEach((p, index) => {
        const div = document.createElement('div'); div.className = 'panel-box mt-1 draggable-item'; div.style.padding = '12px';
        
        // 드래그 핸들에 마우스 오버 시에만 draggable 활성화 (슬라이더 간섭 방지)
        div.addEventListener('mousedown', (e) => {
            if(e.target.classList.contains('drag-handle')) { div.draggable = true; } 
            else { div.draggable = false; }
        });

        div.addEventListener('dragstart', (e) => handleDragStart(e, index));
        div.addEventListener('dragover', handleDragOver);
        div.addEventListener('dragleave', handleDragLeave);
        div.addEventListener('dragend', handleDragEnd);
        div.addEventListener('drop', (e) => handleDrop(e, index, shakerParts, renderShakerPartsUI));

        div.innerHTML = `
            <div class="flex items-center gap-2 mb-2" style="justify-content: space-between;">
                <div class="flex items-center">
                    <span class="drag-handle" title="드래그하여 순서 변경">☰</span>
                    ${p.img ? `<img src="${p.img.src}" style="width:24px; height:24px; object-fit:contain; margin-right:8px; border-radius:4px; border:1px solid var(--border-color);">` : ''}
                    <label style="margin:0;">파츠 이미지</label>
                </div>
                <button class="btn-danger" onclick="removeShakerPart(${p.id})" style="padding: 4px 8px;">삭제</button>
            </div>
            <input type="file" onchange="updateShakerPartFile(event, ${p.id})" accept="image/png">
            <div class="flex gap-2 mt-2">
                <div class="flex-1"><label class="text-muted">수량: <span id="vQty${p.id}">${p.qty}</span>개</label>
                <input type="range" oninput="updateShakerPart(event, 'qty', ${p.id})" min="1" max="20" value="${p.qty}"></div>
                <div class="flex-1"><label class="text-muted">크기: <span id="vScl${p.id}">${p.scale*100}</span>%</label>
                <input type="range" oninput="updateShakerPart(event, 'scale', ${p.id})" min="20" max="200" value="${p.scale*100}"></div>
            </div>
        `;
        list.appendChild(div);
    });
}
window.removeShakerPart = (id) => { shakerParts = shakerParts.filter(p => p.id !== id); renderShakerPartsUI(); };
window.updateShakerPartFile = (e, id) => { fileToImage(e.target.files[0], img => { const pt = shakerParts.find(x => x.id === id); if(pt) pt.img = img; renderShakerPartsUI(); }); };
window.updateShakerPart = (e, type, id) => { 
    const val = parseInt(e.target.value); const pt = shakerParts.find(x => x.id === id); 
    if(!pt) return;
    if(type === 'qty') { pt.qty = val; document.getElementById('vQty'+id).textContent = val; }
    else if(type === 'scale') { pt.scale = val/100; document.getElementById('vScl'+id).textContent = val; }
};
document.getElementById('btnAddShakerPart').addEventListener('click', () => { shakerParts.push({ id: shakerPartIdCounter++, img: null, qty: 1, scale: 1.0 }); renderShakerPartsUI(); });

// --- 동적 리스트 UI 추가 (Diorama) ---
function renderDioramaLayersUI() {
    const list = document.getElementById('diorama-layers-list'); list.innerHTML = '';
    dioramaLayers.forEach((l, index) => {
        const div = document.createElement('div'); div.className = 'panel-box mt-1 draggable-item'; div.style.padding = '12px';
        
        div.addEventListener('mousedown', (e) => {
            if(e.target.classList.contains('drag-handle')) { div.draggable = true; } 
            else { div.draggable = false; }
        });

        div.addEventListener('dragstart', (e) => handleDragStart(e, index));
        div.addEventListener('dragover', handleDragOver);
        div.addEventListener('dragleave', handleDragLeave);
        div.addEventListener('dragend', handleDragEnd);
        div.addEventListener('drop', (e) => handleDrop(e, index, dioramaLayers, renderDioramaLayersUI));

        div.innerHTML = `
            <div class="flex items-center gap-2 mb-2" style="justify-content: space-between;">
                <div class="flex items-center">
                    <span class="drag-handle" title="드래그하여 순서 변경">☰</span>
                    ${l.img ? `<img src="${l.img.src}" style="width:24px; height:24px; object-fit:contain; margin-right:8px; border-radius:4px; border:1px solid var(--border-color);">` : ''}
                    <label style="margin:0;"><span class="text-primary font-bold">[${index+1}]</span> 레이어 이미지</label>
                </div>
                <button class="btn-danger" onclick="removeDioramaLayer(${l.id})" style="padding: 4px 8px;">삭제</button>
            </div>
            <input type="file" onchange="updateDioramaFile(event, ${l.id})" accept="image/png" class="mb-2">
            <div class="flex gap-2">
                <div class="flex-1 flex items-center gap-2"><label class="text-muted m-0">X:</label>
                <input type="range" oninput="updateDioramaOffset(event, 'x', ${l.id})" min="-200" max="200" value="${l.offsetX}" class="flex-1 m-0">
                <input type="number" oninput="updateDioramaOffsetSync(event, 'x', ${l.id})" value="${l.offsetX}"></div>
                <div class="flex-1 flex items-center gap-2"><label class="text-muted m-0">Y:</label>
                <input type="range" oninput="updateDioramaOffset(event, 'y', ${l.id})" min="-200" max="200" value="${l.offsetY}" class="flex-1 m-0">
                <input type="number" oninput="updateDioramaOffsetSync(event, 'y', ${l.id})" value="${l.offsetY}"></div>
            </div>
        `;
        list.appendChild(div);
    });
}
window.removeDioramaLayer = (id) => { dioramaLayers = dioramaLayers.filter(l => l.id !== id); renderDioramaLayersUI(); };
window.updateDioramaFile = (e, id) => { fileToImage(e.target.files[0], img => { const lr = dioramaLayers.find(x => x.id === id); if(lr) lr.img = img; renderDioramaLayersUI(); }); };
window.updateDioramaOffset = (e, axis, id) => { 
    const val = parseInt(e.target.value); const lr = dioramaLayers.find(x => x.id === id); 
    if(!lr) return;
    if(axis === 'x') lr.offsetX = val; else lr.offsetY = val;
    e.target.nextElementSibling.value = val;
    applyDioramaOffsets();
};
window.updateDioramaOffsetSync = (e, axis, id) => {
    const val = parseInt(e.target.value) || 0; const lr = dioramaLayers.find(x => x.id === id); 
    if(!lr) return;
    if(axis === 'x') lr.offsetX = val; else lr.offsetY = val;
    e.target.previousElementSibling.value = val;
    applyDioramaOffsets();
};
function applyDioramaOffsets() {
    if(currentTab !== 'diorama' || !pivotContainer) return;
    dioramaLayers.forEach(l => {
        if(l.groupRef && l.basePos) {
            l.groupRef.position.x = l.basePos.x + l.offsetX;
            l.groupRef.position.y = l.basePos.y + l.offsetY;
        }
    });
}
document.getElementById('btnAddDioramaLayer').addEventListener('click', () => { dioramaLayers.push({ id: dioramaLayerIdCounter++, img: null, offsetX: 0, offsetY: 0, groupRef: null }); renderDioramaLayersUI(); });


// --- 형태 분석 알고리즘 (공통 핵심 코어) ---
function getContour(imageData, width, height) {
    const data = imageData.data; const isSolid = (x, y) => (x>=0 && x<width && y>=0 && y<height) && data[(y*width+x)*4+3]>128;
    let startX = -1, startY = -1;
    for (let y=0; y<height; y++) { for (let x=0; x<width; x++) { if (isSolid(x, y)) { startX=x; startY=y; break; } } if (startX!==-1) break; }
    if (startX===-1) return [];
    const boundary = []; let currX = startX, currY = startY, backDir = 3;
    const dx = [1,1,0,-1,-1,-1,0,1], dy = [0,1,1,1,0,-1,-1,-1];
    let attempts = 0;
    do {
        boundary.push({x: currX, y: currY}); let found = false, searchDir = (backDir + 2) % 8;
        for (let i=0; i<8; i++) { let dir = (searchDir+i)%8; let nx = currX+dx[dir], ny = currY+dy[dir]; if (isSolid(nx, ny)) { currX=nx; currY=ny; backDir=(dir+4)%8; found=true; break; } }
        if (!found || attempts++ > width*height) break;
    } while (currX!==startX || currY!==startY);
    return boundary;
}
function smoothContour(points, windowSize=7) {
    if (points.length<windowSize) return points; const smoothed = [];
    for (let i=0; i<points.length; i++) {
        let sumX=0, sumY=0; for (let j=0; j<windowSize; j++) { let idx = (i+j-Math.floor(windowSize/2)+points.length)%points.length; sumX+=points[idx].x; sumY+=points[idx].y; }
        smoothed.push({ x:sumX/windowSize, y:sumY/windowSize });
    }
    const simplified = [smoothed[0]];
    for(let i=1; i<smoothed.length; i++){ const last=simplified[simplified.length-1]; const dx=smoothed[i].x-last.x, dy=smoothed[i].y-last.y; if(Math.sqrt(dx*dx+dy*dy)>2) simplified.push(smoothed[i]); }
    return simplified;
}

function createShapeFromImage(img, expandPx, maxDim=500) {
    let scale = 1; if (img.width>maxDim || img.height>maxDim) scale = maxDim/Math.max(img.width, img.height);
    const w = Math.floor(img.width*scale), h = Math.floor(img.height*scale), scaledExpand = Math.floor(expandPx*scale), cw = w+scaledExpand*2, ch = h+scaledExpand*2;
    const cvs1 = document.createElement('canvas'); cvs1.width = w; cvs1.height = h; cvs1.getContext('2d').drawImage(img, 0, 0, w, h);
    const cvs2 = document.createElement('canvas'); cvs2.width = cw; cvs2.height = ch; const ctx2 = cvs2.getContext('2d', {willReadFrequently:true});
    for(let angle=0; angle<Math.PI*2; angle+=Math.PI/8) ctx2.drawImage(cvs1, scaledExpand+Math.cos(angle)*scaledExpand, scaledExpand+Math.sin(angle)*scaledExpand);
    const imgData = ctx2.getImageData(0, 0, cw, ch);
    for(let i=0; i<imgData.data.length; i+=4) imgData.data[i+3] = imgData.data[i+3]>30 ? 255 : 0;
    ctx2.putImageData(imgData, 0, 0);
    
    let points = getContour(imgData, cw, ch); if(points.length===0) return null; points = smoothContour(points, 7);
    let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity; points.forEach(p=>{ if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x; if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y; });
    const cx=(minX+maxX)/2, cy=(minY+maxY)/2;
    
    const mappedPoints = points.map(p => ({ x: (p.x-cx)/scale, y: -(p.y-cy)/scale })); // 실제 3D 월드 좌표계 추출
    
    const shape = new THREE.Shape(); 
    shape.moveTo(mappedPoints[0].x, mappedPoints[0].y);
    for(let i=1; i<mappedPoints.length; i++) shape.lineTo(mappedPoints[i].x, mappedPoints[i].y);
    
    return { 
        shape, mappedPoints, scale, 
        planeOffsetX: (cw/2-cx)/scale, planeOffsetY: (cy-ch/2)/scale, 
        bounds: { minX:(minX-cx)/scale, maxX:(maxX-cx)/scale, minY:-(maxY-cy)/scale, maxY:-(minY-cy)/scale } 
    };
}

// 재질 생성 유틸 (렌더 오더 및 알파 테스트로 글리치 완전 해결)
function getMaterial(texture, isGlossy) {
    return isGlossy ? new THREE.MeshPhongMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, alphaTest: 0.5, shininess: 100, specular: 0xffffff })
                    : new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, alphaTest: 0.5 });
}
function getAcrylicMaterial() {
    return new THREE.MeshPhongMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, shininess: 120, specular: 0xffffff, side: THREE.DoubleSide, depthWrite: false });
}

function resetCamera() {
    if(!pivotContainer) return;
    pivotContainer.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(pivotContainer);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(Math.sqrt(size.x*size.x + size.z*size.z), size.y);
    const cameraDist = (maxDim/2) / Math.tan(camera.fov*(Math.PI/180)/2) * 1.35;
    camera.position.set(0, center.y, cameraDist); controls.target.set(0, center.y, 0); controls.update();
}
document.getElementById('btnResetCamera').addEventListener('click', resetCamera);


// --- 자이로스코프(기울기) 및 흔들기 제어 ---
let shakeForceX = 0, shakeForceY = 0;
let lastShakeX = 0, lastShakeY = 0;
let isShaking = false;

// 자이로 변수
let isGyroEnabled = false;
let gyroGravityX = 0;
let gyroGravityY = 0;

// 모바일 전체화면 몰입 모드 진입
function enterGyroMode() {
    isGyroEnabled = true;
    document.getElementById('app-layout').classList.add('gyro-mode');
    document.getElementById('btnExitGyro').style.display = 'block';
    resetCamera();
    if(pivotContainer) pivotContainer.rotation.y = 0; // 정면 응시
}

document.getElementById('btnEnableGyro').addEventListener('click', async () => {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
            const permissionState = await DeviceOrientationEvent.requestPermission();
            if (permissionState === 'granted') {
                window.addEventListener('deviceorientation', handleOrientation);
                enterGyroMode();
            } else {
                alert('자이로스코프 접근이 거부되었습니다. 브라우저 설정에서 권한을 허용해주세요.');
            }
        } catch (error) {
            console.error(error);
            alert('자이로스코프 권한을 요청할 수 없습니다. 이 기능은 HTTPS 환경에서만 동작합니다.');
        }
    } else if ('DeviceOrientationEvent' in window) {
        // 안드로이드 등 권한 요청 없이 바로 허용되는 기기
        window.addEventListener('deviceorientation', handleOrientation);
        enterGyroMode();
    } else {
        alert('이 기기는 자이로스코프 센서를 지원하지 않습니다.');
    }
});

// 편집 모드로 복귀
document.getElementById('btnExitGyro').addEventListener('click', () => {
    isGyroEnabled = false;
    window.removeEventListener('deviceorientation', handleOrientation);
    document.getElementById('app-layout').classList.remove('gyro-mode');
    document.getElementById('btnExitGyro').style.display = 'none';
});

function handleOrientation(event) {
    if (!isGyroEnabled || currentTab !== 'shaker') return;
    
    // 기기의 방향 변환 (X, Y 기울임 정도)
    let tiltX = event.gamma || 0; // -90 ~ 90 (좌우)
    let tiltY = event.beta || 0;  // -180 ~ 180 (상하)

    // 과도한 값 필터링
    tiltX = Math.max(-90, Math.min(90, tiltX));
    tiltY = Math.max(-90, Math.min(90, tiltY));
    
    // 기울기를 중력 크기로 변환
    gyroGravityX = tiltX * 30;  // 폰을 우측으로 기울이면 우측으로 힘 발생
    gyroGravityY = -tiltY * 30; // 폰을 세우면 (beta=90) Y는 -2700 (아래로 쏟아짐)
}

// 화면 터치/드래그 흔들기
canvasEl.addEventListener('mousedown', e => { isShaking = true; lastShakeX = e.clientX; lastShakeY = e.clientY; });
window.addEventListener('mousemove', e => {
    if(isShaking) {
        shakeForceX += (e.clientX - lastShakeX) * 100;
        shakeForceY -= (e.clientY - lastShakeY) * 100;
        lastShakeX = e.clientX; lastShakeY = e.clientY;
    }
});
window.addEventListener('mouseup', () => isShaking = false);

canvasEl.addEventListener('touchstart', e => { isShaking = true; lastShakeX = e.touches[0].clientX; lastShakeY = e.touches[0].clientY; }, {passive:true});
window.addEventListener('touchmove', e => {
    if(isShaking) {
        shakeForceX += (e.touches[0].clientX - lastShakeX) * 100;
        shakeForceY -= (e.touches[0].clientY - lastShakeY) * 100;
        lastShakeX = e.touches[0].clientX; lastShakeY = e.touches[0].clientY;
    }
}, {passive:false});
window.addEventListener('touchend', () => isShaking = false);

// --- 렌더러 분기 ---
document.getElementById('btnGenerate').addEventListener('click', () => {
    if (currentTab === 'stand') generateStand();
    else if (currentTab === 'shaker') generateShaker();
    else generateDiorama();
});

// 청소 함수
function cleanupScene() {
    if(pivotContainer) scene.remove(pivotContainer);
    if(physicsWorld) physicsWorld = null;
    physicsObjects = [];
    shakeForceX = 0; shakeForceY = 0; // 힘 초기화
    pivotContainer = new THREE.Group();
    scene.add(pivotContainer);
}

// 1. 아크릴 스탠드 로직
function generateStand() {
    if(!standImgFront) return alert('앞면 이미지를 선택해주세요.');
    showLoading('아크릴 스탠드 생성 중...');
    setTimeout(() => {
        try {
            cleanupScene();
            const thickness = parseInt(document.getElementById('thickness').value), expandPx = parseInt(document.getElementById('margin').value);
            const frontData = createShapeFromImage(standImgFront, expandPx);
            if(!frontData) throw new Error('외곽선 추출 실패');
            
            const hasBack = !!standImgBack, mode = document.getElementById('contourMode').value, isGlossy = document.getElementById('textureType').value === 'glossy';
            const backData = hasBack ? createShapeFromImage(standImgBack, expandPx) : frontData;
            const texLoader = new THREE.TextureLoader();
            const texFront = texLoader.load(standImgFront.src); const texBack = hasBack ? texLoader.load(standImgBack.src) : texFront;
            const acrylicMat = getAcrylicMaterial(), matFront = getMaterial(texFront, isGlossy), matBack = getMaterial(texBack, isGlossy);
            
            const mainGroup = new THREE.Group();
            
            if (mode === 'unified' || (!hasBack && mode === 'separate')) {
                const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(frontData.shape, {depth: thickness, bevelEnabled:false}), acrylicMat);
                mesh.position.z = -thickness/2; mesh.renderOrder = 0; mainGroup.add(mesh);
                
                const planeF = new THREE.Mesh(new THREE.PlaneGeometry(standImgFront.width, standImgFront.height), matFront);
                planeF.position.set(frontData.planeOffsetX, frontData.planeOffsetY, thickness/2 + 0.1); planeF.renderOrder = 1; mainGroup.add(planeF);
                
                const planeB = new THREE.Mesh(new THREE.PlaneGeometry(hasBack?standImgBack.width:standImgFront.width, hasBack?standImgBack.height:standImgFront.height), matBack);
                if (hasBack) planeB.position.set(-backData.planeOffsetX, backData.planeOffsetY, -thickness/2 - 0.1);
                else { planeB.position.set(frontData.planeOffsetX, frontData.planeOffsetY, -thickness/2 - 0.1); planeB.scale.x = -1; }
                planeB.rotation.y = Math.PI; planeB.renderOrder = 1; mainGroup.add(planeB);
            } else {
                const grpF = new THREE.Group(), grpB = new THREE.Group();
                const mF = new THREE.Mesh(new THREE.ExtrudeGeometry(frontData.shape, {depth: thickness, bevelEnabled:false}), acrylicMat);
                mF.position.z = -thickness/2; mF.renderOrder = 0; grpF.add(mF);
                const pf = new THREE.Mesh(new THREE.PlaneGeometry(standImgFront.width, standImgFront.height), matFront);
                pf.position.set(frontData.planeOffsetX, frontData.planeOffsetY, thickness/2 + 0.1); pf.renderOrder = 1; grpF.add(pf);
                mainGroup.add(grpF);
                
                const mB = new THREE.Mesh(new THREE.ExtrudeGeometry(backData.shape, {depth: thickness, bevelEnabled:false}), acrylicMat);
                mB.position.z = -thickness/2; mB.renderOrder = 0; grpB.add(mB);
                const pb = new THREE.Mesh(new THREE.PlaneGeometry(standImgBack.width, standImgBack.height), matBack);
                pb.position.set(backData.planeOffsetX, backData.planeOffsetY, thickness/2 + 0.1); pb.renderOrder = 1; grpB.add(pb);
                grpB.rotation.y = Math.PI; mainGroup.add(grpB);
                pivotContainer.userData = { mode: 'separate', frontGroup: grpF, backGroup: grpB };
            }

            if(document.getElementById('pivotType').value === 'bottom') {
                mainGroup.position.y = -frontData.bounds.minY; 
                const baseGroup = new THREE.Group();
                const baseRad = parseInt(document.getElementById('baseSize').value);
                const shapeType = document.getElementById('baseShapeType').value;
                let baseShape = new THREE.Shape();
                if(shapeType === 'contour' && standImgBase) baseShape = createShapeFromImage(standImgBase, expandPx).shape;
                else if(shapeType === 'square' || (shapeType==='contour'&&!standImgBase)) { baseShape.moveTo(-baseRad,-baseRad); baseShape.lineTo(baseRad,-baseRad); baseShape.lineTo(baseRad,baseRad); baseShape.lineTo(-baseRad,baseRad); }
                else baseShape.absarc(0,0,baseRad,0,Math.PI*2,false);
                
                const bMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(baseShape, {depth: thickness, bevelEnabled:false}), acrylicMat);
                bMesh.position.z = -thickness/2; bMesh.renderOrder = 0; baseGroup.add(bMesh);
                if (standImgBase) {
                    let pw = standImgBase.width, ph = standImgBase.height;
                    if(shapeType!=='contour') { const scale = (baseRad*1.8)/Math.max(pw,ph); pw*=scale; ph*=scale; }
                    const pMesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), getMaterial(texLoader.load(standImgBase.src), isGlossy));
                    pMesh.position.z = thickness/2 + 0.1; pMesh.renderOrder = 1;
                    if(shapeType==='contour'){ const bd = createShapeFromImage(standImgBase,expandPx); pMesh.position.x=bd.planeOffsetX; pMesh.position.y=bd.planeOffsetY; }
                    baseGroup.add(pMesh);
                }
                baseGroup.rotation.x = -Math.PI/2; baseGroup.position.y = -thickness/2;
                pivotContainer.add(baseGroup);
            }

            pivotContainer.add(mainGroup); resetCamera(); unlockExports(); hideLoading();
        } catch(e) { hideLoading(); alert(e.message); }
    }, 100);
}

// 2. 아크릴 쉐이커 로직 (물리 엔진 적용 - 다각형 외곽선 물리 충돌 완벽 구현)
function generateShaker() {
    const bgType = document.getElementById('shakerBgType').value;
    if(bgType === 'image' && !shakerBgImg) return alert('쉐이커 배경 이미지를 올려주세요.');
    
    let validParts = shakerParts.filter(p => p.img);
    if(validParts.length === 0) return alert('최소 1개의 파츠 이미지를 추가해야 합니다.');
    showLoading('아크릴 쉐이커 생성 중...');

    setTimeout(() => {
        try {
            cleanupScene();
            const thickness = parseInt(document.getElementById('thickness').value), expandPx = parseInt(document.getElementById('margin').value);
            const isGlossy = document.getElementById('textureType').value === 'glossy';
            const texLoader = new THREE.TextureLoader();
            const acrylicMat = getAcrylicMaterial();
            
            // Cannon.js 초기화
            physicsWorld = new CANNON.World();
            physicsWorld.broadphase = new CANNON.SAPBroadphase(physicsWorld);
            
            const matPhys = new CANNON.Material();
            const matContact = new CANNON.ContactMaterial(matPhys, matPhys, { friction: 0.1, restitution: 0.6 });
            physicsWorld.addContactMaterial(matContact);

            // [1] 뒷판 (배경 틀) 
            let bgShape = new THREE.Shape();
            let bgData = null;
            let bw, bh, cx=0, cy=0;
            const bgRadius = parseInt(document.getElementById('shakerBgSize').value) / 2;

            if(bgType === 'image') {
                bgData = createShapeFromImage(shakerBgImg, expandPx);
                if(!bgData) throw new Error("배경 틀 외곽선 추출 실패");
                bgShape = bgData.shape;
                bw = bgData.bounds.maxX - bgData.bounds.minX; bh = bgData.bounds.maxY - bgData.bounds.minY;
            } else if (bgType === 'circle') {
                bgShape.absarc(0,0,bgRadius,0,Math.PI*2,false);
                bw = bgRadius*2; bh = bgRadius*2;
            } else {
                bgShape.moveTo(-bgRadius,-bgRadius); bgShape.lineTo(bgRadius,-bgRadius); bgShape.lineTo(bgRadius,bgRadius); bgShape.lineTo(-bgRadius,bgRadius);
                bw = bgRadius*2; bh = bgRadius*2;
            }

            const frameDepth = thickness * 1.5;
            const bgMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(bgShape, {depth: frameDepth, bevelEnabled:false}), acrylicMat);
            bgMesh.position.z = -frameDepth/2; bgMesh.renderOrder = 0;
            pivotContainer.add(bgMesh);

            if(bgType === 'image' && shakerBgImg) {
                const texBg = texLoader.load(shakerBgImg.src);
                const planeBg = new THREE.Mesh(new THREE.PlaneGeometry(shakerBgImg.width, shakerBgImg.height), getMaterial(texBg, isGlossy));
                planeBg.position.set(bgData.planeOffsetX, bgData.planeOffsetY, frameDepth/2 + 0.1); planeBg.renderOrder = 1;
                pivotContainer.add(planeBg);
            }

            // [2] 앞판 (투명 유리 덮개)
            const gapZ = thickness * 0.8; 
            const frontZ = frameDepth/2 + gapZ;
            
            const coverMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(bgShape, {depth: 2, bevelEnabled:false}), acrylicMat);
            coverMesh.position.z = frontZ; coverMesh.renderOrder = 0; pivotContainer.add(coverMesh);
            
            if(shakerFrontImg) {
                const fData = createShapeFromImage(shakerFrontImg, expandPx);
                const texFront = texLoader.load(shakerFrontImg.src);
                const planeFront = new THREE.Mesh(new THREE.PlaneGeometry(shakerFrontImg.width, shakerFrontImg.height), getMaterial(texFront, isGlossy));
                planeFront.position.set(fData ? fData.planeOffsetX : 0, fData ? fData.planeOffsetY : 0, frontZ + 2.1); planeFront.renderOrder = 1;
                pivotContainer.add(planeFront);
            }
            const areaRatio = parseInt(document.getElementById('shakerAreaRatio').value) / 100;
            let boundaryPoints = [];
            
            if(bgType === 'image') {
                boundaryPoints = bgData.mappedPoints.map(p => ({ x: p.x * areaRatio, y: p.y * areaRatio }));
            } else if (bgType === 'circle') {
                const steps = 32; // 원형을 32각형으로 쪼개서 매끄러운 굴림 구현
                for(let i=0; i<steps; i++) {
                    const a = (i/steps) * Math.PI * 2;
                    boundaryPoints.push({ x: Math.cos(a) * bgRadius * areaRatio, y: Math.sin(a) * bgRadius * areaRatio });
                }
            } else { // square
                const r = bgRadius * areaRatio;
                boundaryPoints = [ {x: -r, y: -r}, {x: r, y: -r}, {x: r, y: r}, {x: -r, y: r} ];
            }

            // 선분을 따라 물리 블록 생성하는 함수
            const makeSegmentWall = (p1, p2) => {
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const len = Math.sqrt(dx*dx + dy*dy);
                if(len < 0.5) return; // 너무 짧은 구간 무시
                
                const angle = Math.atan2(dy, dx);
                const midX = (p1.x + p2.x)/2;
                const midY = (p1.y + p2.y)/2;

                // 선분의 바깥쪽을 향하는 법선(Normal) 벡터 계산
                let nx = -dy; let ny = dx;
                const dot = nx * midX + ny * midY;
                if (dot < 0) { nx = -nx; ny = -ny; }
                const nLen = Math.sqrt(nx*nx + ny*ny) || 1;
                nx /= nLen; ny /= nLen;

                const wallThick = 400; // 파츠가 뚫지 못하도록 아주 두껍게 설정
                // 벽 중심을 윤곽선 바깥쪽으로 밀어내어 내부 공간 확보
                const shiftX = nx * (wallThick / 2);
                const shiftY = ny * (wallThick / 2);

                const body = new CANNON.Body({ mass: 0, material: matPhys });
                // len/2 + 5를 주어 블록 간의 모서리가 겹치도록 하여 사각지대 및 틈새 터널링 방지
                const box = new CANNON.Box(new CANNON.Vec3(len/2 + 5, wallThick/2, gapZ/2)); 
                body.addShape(box);
                
                body.position.set(midX + shiftX, midY + shiftY, frameDepth/2 + gapZ/2);
                
                const q = new CANNON.Quaternion();
                q.setFromAxisAngle(new CANNON.Vec3(0,0,1), angle);
                body.quaternion.copy(q);
                
                physicsWorld.addBody(body);
            };

            // 모든 윤곽선을 따라 다각형 물리 벽 세우기
            for(let i=0; i<boundaryPoints.length; i++) {
                makeSegmentWall(boundaryPoints[i], boundaryPoints[(i+1) % boundaryPoints.length]);
            }

            // [4] 내부 파츠들 생성
            const iw = bw * 0.5, ih = bh * 0.5; // 파츠가 안전하게 중앙 쪽에 스폰되도록 범위 지정
            validParts.forEach(part => {
                const pData = createShapeFromImage(part.img, expandPx/2);
                if(!pData) return;
                const pThick = thickness * 0.4; 
                const pWidth = (pData.bounds.maxX - pData.bounds.minX) * part.scale;
                const pHeight = (pData.bounds.maxY - pData.bounds.minY) * part.scale;
                
                for(let i=0; i<part.qty; i++) {
                    const pMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(pData.shape, {depth: pThick, bevelEnabled:false}), acrylicMat);
                    pMesh.position.z = -pThick/2; pMesh.renderOrder = 0; 

                    const tex = texLoader.load(part.img.src);
                    const pPlane = new THREE.Mesh(new THREE.PlaneGeometry(part.img.width, part.img.height), getMaterial(tex, isGlossy));
                    pPlane.position.set(pData.planeOffsetX, pData.planeOffsetY, pThick/2 + 0.1); pPlane.renderOrder = 1; 
                    
                    const group = new THREE.Group(); group.add(pMesh); group.add(pPlane);
                    group.scale.set(part.scale, part.scale, 1);
                    
                    const startX = cx + (Math.random()-0.5)*iw;
                    const startY = cy + (Math.random()-0.5)*ih;
                    const startZ = frameDepth/2 + gapZ/2; 
                    
                    group.position.set(startX, startY, startZ);
                    pivotContainer.add(group);

                    // 구체형(Sphere) 물리 충돌체 적용
                    const pRadius = Math.max(pWidth, pHeight) / 2 * 0.8; 
                    const body = new CANNON.Body({ mass: (pWidth*pHeight)/100, material: matPhys });
                    const shape = new CANNON.Sphere(pRadius);
                    body.addShape(shape);
                    
                    body.position.set(startX, startY, startZ);
                    
                    physicsWorld.addBody(body);
                    // startZ 값을 저장하여 매 프레임 수동으로 강제 고정함
                    physicsObjects.push({ mesh: group, body: body, startZ: startZ });
                }
            });

            resetCamera(); unlockExports(); hideLoading();
        } catch (e) { hideLoading(); alert(e.message); }
    }, 100);
}

// 3. 디오라마 로직
function generateDiorama() {
    let validLayers = dioramaLayers.filter(l => l.img);
    if(validLayers.length === 0) return alert('최소 1개의 레이어 이미지를 추가해야 합니다.');
    showLoading('디오라마 생성 중...');

    setTimeout(() => {
        try {
            cleanupScene();
            const thickness = parseInt(document.getElementById('thickness').value), expandPx = parseInt(document.getElementById('margin').value);
            const isGlossy = document.getElementById('textureType').value === 'glossy';
            const gap = parseInt(document.getElementById('dioramaGap').value);
            const texLoader = new THREE.TextureLoader();
            const acrylicMat = getAcrylicMaterial();
            
            let globalMinY = Infinity, globalMinX = Infinity, globalMaxX = -Infinity;

            validLayers.forEach((layer, idx) => {
                const data = createShapeFromImage(layer.img, expandPx);
                if(data) {
                    if(data.bounds.minY < globalMinY) globalMinY = data.bounds.minY;
                    if(data.bounds.minX < globalMinX) globalMinX = data.bounds.minX;
                    if(data.bounds.maxX > globalMaxX) globalMaxX = data.bounds.maxX;
                    
                    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(data.shape, {depth: thickness, bevelEnabled:false}), acrylicMat);
                    mesh.position.z = -thickness/2; mesh.renderOrder = 0;
                    const tex = texLoader.load(layer.img.src);
                    const plane = new THREE.Mesh(new THREE.PlaneGeometry(layer.img.width, layer.img.height), getMaterial(tex, isGlossy));
                    plane.position.set(data.planeOffsetX, data.planeOffsetY, thickness/2 + 0.1); plane.renderOrder = 1;
                    
                    const group = new THREE.Group(); group.add(mesh); group.add(plane);
                    const zPos = - ((validLayers.length-1) * gap)/2 + ((validLayers.length - 1 - idx) * gap);
                    
                    layer.basePos = { x: 0, y: -data.bounds.minY, z: zPos }; 
                    group.position.set(layer.basePos.x + layer.offsetX, layer.basePos.y + layer.offsetY, layer.basePos.z);
                    
                    pivotContainer.add(group);
                    layer.groupRef = group;
                }
            });
            
            const bMargin = parseInt(document.getElementById('dioramaBaseMargin').value);
            const totalWidth = (globalMaxX - globalMinX) + bMargin*2;
            const totalDepth = ((validLayers.length-1) * gap) + thickness + bMargin*2;
            
            const baseShape = new THREE.Shape();
            baseShape.moveTo(-totalWidth/2, -totalDepth/2); baseShape.lineTo(totalWidth/2, -totalDepth/2);
            baseShape.lineTo(totalWidth/2, totalDepth/2); baseShape.lineTo(-totalWidth/2, totalDepth/2);
            
            const baseMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(baseShape, {depth: thickness, bevelEnabled:true, bevelThickness: 2, bevelSize: 2}), acrylicMat);
            baseMesh.rotation.x = -Math.PI/2;
            baseMesh.position.y = -thickness - 0.1; baseMesh.renderOrder = 0;
            pivotContainer.add(baseMesh);

            resetCamera(); unlockExports(); hideLoading();
        } catch (e) { hideLoading(); alert(e.message); }
    }, 100);
}

// --- 공통 애니메이션 & 렌더링 루프 ---
function animate() {
    requestAnimationFrame(animate);
    controls.update();

    const speed = parseInt(document.getElementById('rotationSpeed').value);
    if (pivotContainer && speed > 0) pivotContainer.rotation.y += speed * 0.01;

    if (pivotContainer && pivotContainer.userData.mode === 'separate' && pivotContainer.userData.backGroup) {
        const camPos = new THREE.Vector3(); camera.getWorldPosition(camPos);
        const centerPos = new THREE.Vector3(); pivotContainer.getWorldPosition(centerPos);
        const viewVec = camPos.sub(centerPos).normalize();
        const fwdVec = new THREE.Vector3(0,0,1).applyQuaternion(pivotContainer.quaternion);
        if (fwdVec.dot(viewVec) >= 0) { pivotContainer.userData.frontGroup.visible = true; pivotContainer.userData.backGroup.visible = false; }
        else { pivotContainer.userData.frontGroup.visible = false; pivotContainer.userData.backGroup.visible = true; }
    }

    if (physicsWorld && currentTab === 'shaker' && pivotContainer) {
        let gx = shakeForceX;
        let gy = shakeForceY;

        if (isGyroEnabled) {
            gx += gyroGravityX;
            gy += gyroGravityY;
        } else {
            const worldDown = new THREE.Vector3(0, -1, 0).applyQuaternion(camera.quaternion);
            const invQuat = pivotContainer.quaternion.clone().invert();
            const localDown = worldDown.applyQuaternion(invQuat);
            gx += localDown.x * 3000;
            gy += localDown.y * 3000;
        }
        
        gx = Math.max(Math.min(gx, 15000), -15000);
        gy = Math.max(Math.min(gy, 15000), -15000);

        physicsWorld.gravity.set(gx, gy, 0);
        
        shakeForceX *= 0.85; 
        shakeForceY *= 0.85;

        physicsWorld.step(1/60);
        for(let obj of physicsObjects) {
            
            obj.body.position.z = obj.startZ;
            obj.body.velocity.z = 0; 
            
            obj.body.angularVelocity.x = 0;
            obj.body.angularVelocity.y = 0;

            obj.body.wakeUp(); 
            obj.mesh.position.copy(obj.body.position);
            obj.mesh.quaternion.copy(obj.body.quaternion);
        }
    }

    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(uiScene, uiCamera);
}
animate();

// --- Export 기능 ---
function unlockExports() {
    document.getElementById('btnExportVideo').disabled = false;
    document.getElementById('btnExportAPNG').disabled = false;
    document.getElementById('btnExportGIF').disabled = false;
    document.getElementById('btnExportGLTF').disabled = false;
}

document.getElementById('btnExportVideo').addEventListener('click', () => {
    if (!pivotContainer) return;
    showLoading('영상을 녹화 중입니다...');
    const origSpeed = document.getElementById('rotationSpeed').value;
    if(origSpeed === "0" && currentTab !== 'shaker') { document.getElementById('rotationSpeed').value = 0; pivotContainer.rotation.y = 0; }
    const stream = canvasEl.captureStream(30);
    const mime = document.getElementById('bgTransparent').checked && MediaRecorder.isTypeSupported('video/webm; codecs=vp9') ? 'video/webm; codecs=vp9' : 'video/webm';
    let rec; try{rec=new MediaRecorder(stream,{mimeType:mime});}catch(e){rec=new MediaRecorder(stream);}
    const chunks = []; rec.ondataavailable=e=>{if(e.data.size>0)chunks.push(e.data);};
    rec.onstop = () => {
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(chunks,{type:mime})); a.download='acrylic-goods.webm'; a.click();
        document.getElementById('rotationSpeed').value = origSpeed; hideLoading();
    };
    const totalFrames = 90; let frame=0; rec.start(100);
    function recordFrame() {
        if(frame<=totalFrames) { if(origSpeed==="0" && currentTab!=='shaker') pivotContainer.rotation.y = (frame/totalFrames)*Math.PI*2; frame++; requestAnimationFrame(recordFrame); }
        else rec.stop();
    }
    recordFrame();
});

document.getElementById('btnExportAPNG').addEventListener('click', async () => {
    if (!pivotContainer || typeof UPNG === 'undefined') return;
    showLoading('APNG 프레임을 캡처 중입니다...');
    const origSpeed = document.getElementById('rotationSpeed').value;
    if(origSpeed === "0" && currentTab !== 'shaker') { document.getElementById('rotationSpeed').value = 0; pivotContainer.rotation.y = 0; }
    const isTrans = document.getElementById('bgTransparent').checked;
    
    const frames = []; const delays = [];
    const tempCanvas = document.createElement('canvas'); tempCanvas.width = CANVAS_SIZE; tempCanvas.height = CANVAS_SIZE;
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
    const totalFrames = 45;

    for(let frame = 0; frame < totalFrames; frame++) {
        if(origSpeed==="0" && currentTab!=='shaker') pivotContainer.rotation.y = (frame / totalFrames) * Math.PI * 2;
        if (isTrans) renderer.setClearColor(0x000000, 0);
        renderer.clear(); renderer.render(scene, camera); renderer.clearDepth(); renderer.render(uiScene, uiCamera);
        
        tempCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE); tempCtx.drawImage(canvasEl, 0, 0);
        frames.push(tempCtx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data.buffer);
        delays.push(60);
        await new Promise(resolve => requestAnimationFrame(resolve));
    }

    loadingText.innerHTML = 'APNG로 병합/인코딩 중...<br><span style="font-size: 13px; color: #f59e0b;">※ 멈춤 현상 발생 가능</span>';
    setTimeout(() => {
        try {
            const apngBuffer = UPNG.encode(frames, CANVAS_SIZE, CANVAS_SIZE, 0, delays);
            const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([apngBuffer], { type: 'image/apng' })); a.download = 'acrylic-animated.png'; a.click();
        } catch (err) { alert("APNG 인코딩에 실패했습니다."); }
        document.getElementById('rotationSpeed').value = origSpeed; updateBackground(); hideLoading();
    }, 100);
});

document.getElementById('btnExportGIF').addEventListener('click', () => {
    if (!pivotContainer) return;
    showLoading('GIF를 생성 중입니다... 창을 닫지 마세요.');
    const origSpeed = document.getElementById('rotationSpeed').value;
    if(origSpeed === "0" && currentTab !== 'shaker') pivotContainer.rotation.y = 0;
    const isTrans = document.getElementById('bgTransparent').checked;
    const workerBlob = new Blob([`importScripts('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js');`], {type:'application/javascript'});
    const workerUrl = URL.createObjectURL(workerBlob);
    const gifOpt = {workers:2, quality:10, width:CANVAS_SIZE, height:CANVAS_SIZE, workerScript:workerUrl};
    if(isTrans) gifOpt.transparent = 0xFF00FF;
    const gif = new GIF(gifOpt);
    const totalFrames = 45; let frame = 0;
    function addFrame() {
        if(frame<totalFrames) {
            if(origSpeed==="0" && currentTab!=='shaker') pivotContainer.rotation.y = (frame/totalFrames)*Math.PI*2;
            if(isTrans) { renderer.setClearColor(0xFF00FF,1); scene.background=new THREE.Color(0xFF00FF); }
            renderer.clear(); renderer.render(scene, camera); renderer.clearDepth(); renderer.render(uiScene, uiCamera);
            gif.addFrame(renderer.domElement, {copy:true, delay:60});
            frame++; requestAnimationFrame(addFrame);
        } else {
            loadingText.textContent = 'GIF 인코딩 중...'; updateBackground(); gif.render();
        }
    }
    gif.on('finished', blob => {
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download='acrylic-animated.gif'; a.click();
        document.getElementById('rotationSpeed').value = origSpeed; hideLoading();
    });
    addFrame();
});

document.getElementById('btnExportGLTF').addEventListener('click', () => {
    if (!pivotContainer) return;
    showLoading('3D 모델 추출 중...');
    new THREE.GLTFExporter().parse(pivotContainer, gltf => {
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([gltf], {type:'application/octet-stream'})); a.download='acrylic-goods.glb'; a.click(); hideLoading();
    }, { binary: true });
});

// --- 라이선스 모달 로직 ---
const licenseModal = document.getElementById('licenseModal');
document.getElementById('btnLicenseInfo').addEventListener('click', () => licenseModal.classList.add('show'));
document.getElementById('btnCloseModal').addEventListener('click', () => licenseModal.classList.remove('show'));
licenseModal.addEventListener('click', e => { if (e.target === licenseModal) licenseModal.classList.remove('show'); });
