(() => {
  'use strict';

  // URL pública del único backend de Apps Script. No contiene credenciales.
  const BACKEND_URL = 'https://script.google.com/macros/s/AKfycbxFVOcmraSuCzpbOrZdGnRLitiy55kNXag6N8WeIyXYGixtaZ9JKXISMRLLM41wFv06/exec';
  const BRIDGE_CHANNEL = 'SIGI_BACKEND_V1';
  const pendingCalls = new Map();

  const pdfjsLib = window['pdfjs-dist/build/pdf'];
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
  const { PDFDocument, StandardFonts, rgb } = PDFLib;

  const state = {
    area: '',
    token: '',
    activeSigner: 'TITULAR',
    signerLabel: ['FIRMA', 'JEFA UNIDAD ACTIVIDAD FÍSICA'],
    maxPdfBytes: 12 * 1024 * 1024,
    pdfFile: null,
    pdfBytes: null,
    pdfJsDoc: null,
    pageNumber: 0,
    displayScale: 1,
    zoom: 1,
    signatureFile: null,
    signatureOriginalDataUrl: '',
    professorSignatureDataUrl: '',
    signatureAspect: 2,
    placementConfirmed: false,
    placementValid: false,
    renderNonce: 0,
    drag: null,
    resizing: null,
    lastTouchTap: 0,
    adminToken: '',
    adminData: null,
    adminSignatureDataUrl: ''
  };

  const el = id => document.getElementById(id);
  const dom = {
    loading: el('loading-screen'), areaScreen: el('area-screen'), app: el('app'),
    areaTitle: el('area-title'), backArea: el('back-area'), name: el('professor-name'),
    pdfInput: el('pdf-input'), pdfPicker: el('pdf-picker'), pdfFilename: el('pdf-filename'),
    signatureInput: el('signature-input'), signaturePicker: el('signature-picker'),
    signatureFilename: el('signature-filename'), removeBackground: el('remove-background'),
    backgroundLevel: el('background-level'), previewCard: el('signature-preview-card'),
    miniPreview: el('signature-mini-preview'), emptyViewer: el('empty-viewer'),
    canvasContainer: el('canvas-container'), canvas: el('pdf-canvas'), viewerScroll: el('viewer-scroll'),
    group: el('signature-group'), professorBox: el('professor-signature-box'),
    professorImage: el('professor-signature-image'), professorVisual: el('professor-signature-visual'), resizeHandle: el('resize-handle'),
    chiefPlaceholder: el('chief-placeholder'), chiefLabel: el('chief-label'),
    viewerStatus: el('viewer-status'), pageInfo: el('page-info'), placementMessage: el('placement-message'),
    send: el('send-report'), confirmationHint: el('confirmation-hint'),
    zoomIn: el('zoom-in'), zoomOut: el('zoom-out'), zoomValue: el('zoom-value'), toast: el('toast'),
    history: el('session-history'), historyList: el('session-history-list'),
    successModal: el('success-modal'), successCopy: el('success-copy'), successContinue: el('success-continue')
  };

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    bindEvents();
    window.addEventListener('message', receiveBackendMessage);
    serverCall('getBootstrapData')
      .then(onBootstrap)
      .catch(error => fatal(errorMessage(error)));
  }

  function bindEvents() {
    document.querySelectorAll('[data-area]').forEach(button => {
      button.addEventListener('click', () => selectArea(button.dataset.area));
    });
    dom.backArea.addEventListener('click', resetToAreaSelection);
    dom.pdfPicker.addEventListener('click', () => dom.pdfInput.click());
    dom.signaturePicker.addEventListener('click', () => dom.signatureInput.click());
    dom.pdfInput.addEventListener('change', onPdfSelected);
    dom.signatureInput.addEventListener('change', onSignatureSelected);
    dom.removeBackground.addEventListener('change', () => {
      dom.backgroundLevel.disabled = !dom.removeBackground.checked;
      if (state.signatureOriginalDataUrl) processSignature();
    });
    dom.backgroundLevel.addEventListener('change', () => {
      if (state.signatureOriginalDataUrl) processSignature();
    });
    dom.send.addEventListener('click', sendReport);
    dom.successContinue.addEventListener('click', returnToHome);
    dom.zoomIn.addEventListener('click', () => setZoom(state.zoom + .1));
    dom.zoomOut.addEventListener('click', () => setZoom(state.zoom - .1));
    window.addEventListener('resize', debounce(() => {
      if (state.pdfJsDoc && state.pageNumber && !state.placementConfirmed) renderSelectedPage(true);
    }, 220));

    dom.group.addEventListener('pointerdown', startDrag);
    dom.group.addEventListener('dblclick', event => {
      if (event.target === dom.resizeHandle) return;
      event.preventDefault();
      togglePlacementWithLock();
    });
    dom.resizeHandle.addEventListener('pointerdown', startResize);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', endPointerAction);
    document.addEventListener('pointercancel', endPointerAction);
    window.addEventListener('hashchange', routeFromHash);
    bindAdminEvents();
  }

  function onBootstrap(data) {
    state.token = data.token;
    state.activeSigner = data.activeSigner;
    state.signerLabel = data.signerLabel;
    state.maxPdfBytes = data.maxPdfBytes;
    updateChiefLabel();
    renderSessionHistory();
    dom.loading.classList.add('hidden');
    dom.app.classList.add('hidden');
    routeFromHash();
  }

  function routeFromHash() {
    const adminScreen = el('admin-screen');
    if (window.location.hash === '#admin') {
      dom.loading.classList.add('hidden');
      dom.areaScreen.classList.add('hidden');
      dom.app.classList.add('hidden');
      adminScreen.classList.remove('hidden');
      if (state.adminToken) {
        el('admin-login').classList.add('hidden');
        el('admin-panel').classList.remove('hidden');
      } else {
        el('admin-login').classList.remove('hidden');
        el('admin-panel').classList.add('hidden');
        setTimeout(() => el('admin-password').focus(), 50);
      }
      return;
    }
    adminScreen.classList.add('hidden');
    dom.app.classList.add('hidden');
    dom.areaScreen.classList.remove('hidden');
    renderSessionHistory();
  }

  function bindAdminEvents() {
    el('admin-login-button').addEventListener('click', adminLogin);
    el('admin-password').addEventListener('keydown', event => { if (event.key === 'Enter') adminLogin(); });
    el('admin-year').addEventListener('change', fillAdminFolders);
    el('admin-save-general').addEventListener('click', saveAdminGeneral);
    el('admin-test-folders').addEventListener('click', () => saveOrTestAdminFolders(false));
    el('admin-save-folders').addEventListener('click', () => saveOrTestAdminFolders(true));
    el('admin-signature-file').addEventListener('change', prepareAdminSignature);
    el('admin-background-mode').addEventListener('change', prepareAdminSignature);
    el('admin-upload-signature').addEventListener('click', uploadAdminSignature);
    el('admin-change-password').addEventListener('click', changeAdminPassword);
  }

  async function adminLogin() {
    const password = el('admin-password').value;
    if (!password) return adminStatus('admin-login-status', 'Escribe la contraseña.', true);
    setAdminBusy('admin-login-button', true);
    try {
      const response = await serverCall('adminLogin', password);
      state.adminToken = response.token;
      el('admin-password').value = '';
      el('admin-login').classList.add('hidden');
      el('admin-panel').classList.remove('hidden');
      await refreshAdmin();
    } catch (error) {
      adminStatus('admin-login-status', errorMessage(error), true);
    } finally { setAdminBusy('admin-login-button', false); }
  }

  async function refreshAdmin() {
    try {
      const data = await serverCall('getAdminData', state.adminToken);
      state.adminData = data;
      el('admin-active-signer').value = data.activeSigner;
      el('admin-grace-days').value = data.graceDays;
      markAdminSignature('admin-titular-state', 'Titular', data.hasTitularSignature);
      markAdminSignature('admin-subrogante-state', 'Subrogante', data.hasSubroganteSignature);
      const now = new Date().getFullYear();
      const years = new Set([now - 1, now, now + 1]);
      data.years.forEach(item => years.add(Number(item.year)));
      el('admin-year').innerHTML = [...years].sort((a, b) => b - a).map(year => `<option>${year}</option>`).join('');
      el('admin-year').value = String(now);
      fillAdminFolders();
      el('admin-recent').innerHTML = data.recent.length ? data.recent.map(item =>
        `<div class="admin-recent-row"><strong>${escapeHtml(item.area)} · ${escapeHtml(item.filename)}</strong><br>${escapeHtml(item.professorName)} · ${escapeHtml(item.month)} ${escapeHtml(item.year)} · <a href="${escapeHtml(item.fileUrl)}" target="_blank" rel="noopener noreferrer">Abrir en Drive</a></div>`
      ).join('') : 'Todavía no hay envíos.';
    } catch (error) { handleAdminError(error); }
  }

  function fillAdminFolders() {
    if (!state.adminData) return;
    const row = state.adminData.years.find(item => String(item.year) === el('admin-year').value);
    el('admin-cem').value = row ? row.cem : '';
    el('admin-dps').value = row ? row.dps : '';
  }

  async function saveAdminGeneral() {
    setAdminBusy('admin-save-general', true);
    try {
      const response = await serverCall('saveGeneralSettings', state.adminToken, {
        activeSigner: el('admin-active-signer').value,
        graceDays: el('admin-grace-days').value
      });
      adminStatus('admin-general-status', response.message, false);
      await refreshAdmin();
    } catch (error) { handleAdminError(error, 'admin-general-status'); }
    finally { setAdminBusy('admin-save-general', false); }
  }

  function adminFolderPayload() {
    return { year: Number(el('admin-year').value), cem: el('admin-cem').value.trim(), dps: el('admin-dps').value.trim() };
  }

  async function saveOrTestAdminFolders(save) {
    const buttonId = save ? 'admin-save-folders' : 'admin-test-folders';
    setAdminBusy(buttonId, true);
    try {
      const response = await serverCall(save ? 'saveAnnualFolders' : 'testAnnualFolders', state.adminToken, adminFolderPayload());
      adminStatus('admin-folder-status', `${response.message || 'Acceso correcto.'} CEM: ${response.cemName}. DPS: ${response.dpsName}.`, false);
      if (save) await refreshAdmin();
    } catch (error) { handleAdminError(error, 'admin-folder-status'); }
    finally { setAdminBusy(buttonId, false); }
  }

  async function prepareAdminSignature() {
    const file = el('admin-signature-file').files[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type) || file.size > 3 * 1024 * 1024) {
      el('admin-signature-file').value = '';
      return adminStatus('admin-signature-status', 'Selecciona una imagen PNG, JPG o WEBP de hasta 3 MB.', true);
    }
    try {
      const source = await readFileAsDataUrl(file);
      const mode = el('admin-background-mode').value;
      const processed = await normalizeSignatureImage(source, mode !== 'none', mode === 'none' ? 'normal' : mode);
      state.adminSignatureDataUrl = processed.dataUrl;
      el('admin-signature-preview').innerHTML = `<img src="${processed.dataUrl}" alt="Vista previa de la firma">`;
      el('admin-upload-signature').disabled = false;
      el('admin-signature-status').classList.add('hidden');
    } catch (error) { adminStatus('admin-signature-status', 'No fue posible procesar esta imagen.', true); }
  }

  async function uploadAdminSignature() {
    if (!state.adminSignatureDataUrl) return;
    setAdminBusy('admin-upload-signature', true);
    try {
      const response = await serverCall('uploadSignerSignature', state.adminToken, {
        signer: el('admin-signature-type').value,
        dataUrl: state.adminSignatureDataUrl
      });
      adminStatus('admin-signature-status', response.message, false);
      state.adminSignatureDataUrl = '';
      el('admin-signature-file').value = '';
      el('admin-upload-signature').disabled = true;
      el('admin-signature-preview').innerHTML = '<span class="admin-muted">Vista previa</span>';
      await refreshAdmin();
    } catch (error) { handleAdminError(error, 'admin-signature-status'); }
    finally { setAdminBusy('admin-upload-signature', false); }
  }

  async function changeAdminPassword() {
    setAdminBusy('admin-change-password', true);
    try {
      const response = await serverCall('changeAdminPassword', state.adminToken,
        el('admin-current-password').value, el('admin-new-password').value);
      adminStatus('admin-password-status', response.message, false);
      el('admin-current-password').value = '';
      el('admin-new-password').value = '';
    } catch (error) { handleAdminError(error, 'admin-password-status'); }
    finally { setAdminBusy('admin-change-password', false); }
  }

  function handleAdminError(error, statusId) {
    const message = errorMessage(error);
    if (/sesión administrativa vencida/i.test(message)) {
      state.adminToken = '';
      el('admin-panel').classList.add('hidden');
      el('admin-login').classList.remove('hidden');
      adminStatus('admin-login-status', message, true);
      return;
    }
    if (statusId) adminStatus(statusId, message, true); else toast(message, 'error');
  }

  function adminStatus(id, message, error) {
    const target = el(id);
    target.textContent = message;
    target.className = `admin-status ${error ? 'error' : 'ok'}`;
  }

  function setAdminBusy(id, busy) {
    const button = el(id);
    button.disabled = busy;
    button.classList.toggle('processing', busy);
  }

  function markAdminSignature(id, label, ready) {
    const target = el(id);
    target.classList.toggle('ready', ready);
    target.textContent = `${label}: ${ready ? 'configurada' : 'pendiente'}`;
  }

  function selectArea(area) {
    state.area = area;
    dom.areaTitle.textContent = area;
    dom.areaScreen.classList.add('hidden');
    dom.app.classList.remove('hidden');
    updateSteps();
  }

  function resetToAreaSelection() {
    if (state.pdfFile || state.signatureFile) {
      if (!window.confirm('Se perderan los archivos cargados. ¿Quieres cambiar de programa?')) return;
    }
    returnToHome();
  }

  async function onPdfSelected(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      return toast('Selecciona un archivo PDF.', 'error');
    }
    if (file.size > state.maxPdfBytes) {
      return toast('El informe supera el limite de 12 MB.', 'error');
    }

    try {
      setViewerStatus('Leyendo el informe...', file.name);
      state.pdfFile = file;
      state.pdfBytes = await file.arrayBuffer();
      state.pdfJsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(state.pdfBytes.slice(0)) }).promise;
      state.pageNumber = await findLastContentPage(state.pdfJsDoc);
      dom.pdfFilename.textContent = file.name;
      await renderSelectedPage(false);
      maybeShowSignatureGroup();
      updateSteps();
    } catch (error) {
      console.error(error);
      state.pdfFile = null;
      state.pdfBytes = null;
      toast('No fue posible abrir este PDF.', 'error');
      setViewerStatus('No se pudo abrir el informe', 'Prueba nuevamente');
    }
  }

  async function findLastContentPage(pdfDoc) {
    for (let number = pdfDoc.numPages; number >= 1; number -= 1) {
      const page = await pdfDoc.getPage(number);
      const textContent = await page.getTextContent();
      const meaningfulText = textContent.items
        .map(item => item.str || '')
        .join(' ')
        .replace(/Pag\.\s*\d+\s+de\s+\d+/gi, '')
        .replace(/Pág\.\s*\d+\s+de\s+\d+/gi, '')
        .trim();
      if (meaningfulText.length >= 20) return number;
      if (await pageHasVisualContent(page)) return number;
    }
    return 1;
  }

  async function pageHasVisualContent(page) {
    const viewport = page.getViewport({ scale: .35 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    await page.render({ canvasContext: context, viewport }).promise;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    const startY = Math.floor(canvas.height * .18);
    for (let y = startY; y < canvas.height; y += 2) {
      for (let x = 8; x < canvas.width - 8; x += 2) {
        const i = (y * canvas.width + x) * 4;
        if (data[i] < 225 || data[i + 1] < 225 || data[i + 2] < 225) dark += 1;
      }
    }
    return dark > 65;
  }

  async function renderSelectedPage(preserveRelativePosition) {
    if (!state.pdfJsDoc || !state.pageNumber) return;
    const nonce = ++state.renderNonce;
    const previous = preserveRelativePosition ? getRelativeGroupPosition() : null;
    const page = await state.pdfJsDoc.getPage(state.pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(310, dom.viewerScroll.clientWidth - 36);
    state.displayScale = clamp(availableWidth / baseViewport.width, .52, 1.28);
    const viewport = page.getViewport({ scale: state.displayScale });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    dom.canvas.width = Math.ceil(viewport.width * dpr);
    dom.canvas.height = Math.ceil(viewport.height * dpr);
    dom.canvas.style.width = viewport.width + 'px';
    dom.canvas.style.height = viewport.height + 'px';
    dom.canvasContainer.style.width = viewport.width + 'px';
    dom.canvasContainer.style.height = viewport.height + 'px';

    const context = dom.canvas.getContext('2d', { willReadFrequently: true });
    await page.render({
      canvasContext: context,
      viewport,
      transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0]
    }).promise;
    if (nonce !== state.renderNonce) return;

    dom.emptyViewer.classList.add('hidden');
    dom.canvasContainer.classList.remove('hidden');
    setZoom(1, false);
    setViewerStatus('Revisa la ubicacion de las firmas', 'Ultima pagina con contenido');
    dom.pageInfo.textContent = `Pagina ${state.pageNumber} de ${state.pdfJsDoc.numPages}`;

    if (state.professorSignatureDataUrl) {
      if (dom.group.classList.contains('hidden')) {
        initializeSignatureSizes();
      }
      showSignatureGroup();
      if (previous) setRelativeGroupPosition(previous);
      else autoPlaceGroup();
    }
  }

  async function onSignatureSelected(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|bmp)$/i.test(file.type)) {
      return toast('Selecciona una imagen PNG, JPG, WEBP o BMP.', 'error');
    }

    state.signatureFile = file;
    dom.signatureFilename.textContent = file.name;
    state.signatureOriginalDataUrl = await readFileAsDataUrl(file);
    await processSignature();
    updateSteps();
  }

  async function processSignature() {
    try {
      const previous = !dom.group.classList.contains('hidden') ? {
        position: getRelativeGroupPosition(), width: dom.professorBox.offsetWidth,
        confirmed: state.placementConfirmed
      } : null;
      const processed = await normalizeSignatureImage(
        state.signatureOriginalDataUrl,
        dom.removeBackground.checked,
        dom.backgroundLevel.value
      );
      state.professorSignatureDataUrl = processed.dataUrl;
      state.signatureAspect = processed.width / processed.height;
      dom.professorImage.src = processed.dataUrl;
      dom.miniPreview.src = processed.dataUrl;
      dom.previewCard.classList.remove('hidden');
      if (previous) applySignatureBoxSize(previous.width);
      else initializeSignatureSizes();
      maybeShowSignatureGroup(previous);
      if (previous && previous.position) {
        setRelativeGroupPosition(previous.position);
        state.placementConfirmed = previous.confirmed;
        dom.group.classList.toggle('confirmed', previous.confirmed);
        dom.confirmationHint.textContent = previous.confirmed ? 'Ubicación confirmada · doble clic para editar' : 'Doble clic para confirmar';
        updateActionAvailability();
      }
    } catch (error) {
      console.error(error);
      toast('No fue posible procesar la imagen de firma.', 'error');
    }
  }

  async function normalizeSignatureImage(dataUrl, removeWhite, level) {
    const image = await loadImage(dataUrl);
    const maxSourceWidth = 1200;
    const sourceScale = Math.min(1, maxSourceWidth / image.naturalWidth);
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = Math.max(1, Math.round(image.naturalWidth * sourceScale));
    sourceCanvas.height = Math.max(1, Math.round(image.naturalHeight * sourceScale));
    const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    sourceCtx.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height);
    const imageData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const data = imageData.data;
    const thresholdMap = { soft: 242, normal: 226, strong: 206 };
    const threshold = thresholdMap[level] || 226;

    let minX = sourceCanvas.width, minY = sourceCanvas.height, maxX = -1, maxY = -1;
    for (let y = 0; y < sourceCanvas.height; y += 1) {
      for (let x = 0; x < sourceCanvas.width; x += 1) {
        const i = (y * sourceCanvas.width + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const minChannel = Math.min(r, g, b);
        const colorSpread = Math.max(r, g, b) - minChannel;
        const isInk = minChannel < 238 || colorSpread > 18;
        if (isInk) {
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
        if (removeWhite) {
          if (minChannel >= threshold && colorSpread < 24) {
            const alpha = Math.round(255 * (255 - minChannel) / Math.max(1, 255 - threshold));
            data[i + 3] = clamp(alpha, 0, 255);
          }
        }
      }
    }
    sourceCtx.putImageData(imageData, 0, 0);

    if (maxX < minX || maxY < minY) {
      minX = 0; minY = 0; maxX = sourceCanvas.width - 1; maxY = sourceCanvas.height - 1;
    }
    const padding = Math.max(6, Math.round(Math.max(sourceCanvas.width, sourceCanvas.height) * .015));
    minX = Math.max(0, minX - padding); minY = Math.max(0, minY - padding);
    maxX = Math.min(sourceCanvas.width - 1, maxX + padding); maxY = Math.min(sourceCanvas.height - 1, maxY + padding);
    const cropWidth = maxX - minX + 1, cropHeight = maxY - minY + 1;

    const output = document.createElement('canvas');
    const outputScale = Math.min(1, 800 / cropWidth);
    output.width = Math.max(1, Math.round(cropWidth * outputScale));
    output.height = Math.max(1, Math.round(cropHeight * outputScale));
    output.getContext('2d').drawImage(
      sourceCanvas, minX, minY, cropWidth, cropHeight,
      0, 0, output.width, output.height
    );

    return { dataUrl: output.toDataURL('image/png'), width: output.width, height: output.height };
  }

  function maybeShowSignatureGroup(previous) {
    if (state.pdfJsDoc && state.professorSignatureDataUrl) showSignatureGroup(previous);
  }

  function showSignatureGroup(previous) {
    dom.group.classList.remove('hidden');
    if (!previous) {
      state.placementConfirmed = false;
      dom.group.classList.remove('confirmed');
      dom.confirmationHint.textContent = 'Doble clic para confirmar';
      autoPlaceGroup();
    }
    validatePlacement(true);
  }

  function autoPlaceGroup() {
    requestAnimationFrame(() => {
      const canvasWidth = dom.canvas.clientWidth;
      const canvasHeight = dom.canvas.clientHeight;
      if (!canvasWidth) return;
      const groupWidth = dom.group.offsetWidth;
      const groupHeight = dom.group.offsetHeight;
      const contentBottom = findContentBottomCss();
      const maxY = Math.max(8, canvasHeight - groupHeight - 12);
      const top = clamp(contentBottom + 18, canvasHeight * .28, maxY);
      const left = clamp((canvasWidth - groupWidth) / 2, 10, canvasWidth - groupWidth - 10);
      setGroupPosition(left, top);
      if (!validatePlacement(false)) findLeastOccupiedPlacement();
    });
  }

  function findContentBottomCss() {
    const context = dom.canvas.getContext('2d', { willReadFrequently: true });
    const width = dom.canvas.width, height = dom.canvas.height;
    const data = context.getImageData(0, 0, width, height).data;
    const cssRatio = dom.canvas.clientHeight / height;
    const startY = Math.floor(height * .12);
    const endY = Math.floor(height * .90);
    let bottom = Math.floor(height * .25);
    for (let y = startY; y < endY; y += 3) {
      let dark = 0;
      for (let x = Math.floor(width * .04); x < width * .96; x += 4) {
        const i = (y * width + x) * 4;
        if (data[i] < 225 || data[i + 1] < 225 || data[i + 2] < 225) dark += 1;
      }
      if (dark > 2) bottom = y;
    }
    return bottom * cssRatio;
  }

  function findLeastOccupiedPlacement() {
    const canvasWidth = dom.canvas.clientWidth;
    const canvasHeight = dom.canvas.clientHeight;
    const groupWidth = dom.group.offsetWidth, groupHeight = dom.group.offsetHeight;
    let best = null;
    const startY = Math.floor(canvasHeight * .30);
    for (let y = startY; y <= canvasHeight - groupHeight - 10; y += 18) {
      for (let x = 10; x <= canvasWidth - groupWidth - 10; x += 18) {
        const ratio = underlyingInkRatio(x, y, groupWidth, groupHeight);
        const score = ratio + y / canvasHeight * .002;
        if (!best || score < best.score) best = { x, y, score, ratio };
      }
    }
    if (best) setGroupPosition(best.x, best.y);
    validatePlacement(true);
  }

  function startDrag(event) {
    if (state.placementConfirmed || event.target === dom.resizeHandle) return;
    event.preventDefault();
    dom.group.setPointerCapture?.(event.pointerId);
    state.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: parseFloat(dom.group.style.left) || 0,
      top: parseFloat(dom.group.style.top) || 0
      ,moved: false
    };
    dom.group.classList.add('dragging');
  }

  function startResize(event) {
    if (state.placementConfirmed) return;
    event.preventDefault();
    event.stopPropagation();
    state.resizing = { pointerId: event.pointerId, startX: event.clientX, width: dom.professorBox.offsetWidth };
  }

  function onPointerMove(event) {
    if (state.drag && event.pointerId === state.drag.pointerId) {
      if (Math.abs(event.clientX - state.drag.startX) > 4 || Math.abs(event.clientY - state.drag.startY) > 4) state.drag.moved = true;
      const deltaX = (event.clientX - state.drag.startX) / state.zoom;
      const deltaY = (event.clientY - state.drag.startY) / state.zoom;
      const left = clamp(state.drag.left + deltaX, 0, dom.canvas.clientWidth - dom.group.offsetWidth);
      const top = clamp(state.drag.top + deltaY, 0, dom.canvas.clientHeight - dom.group.offsetHeight);
      setGroupPosition(left, top);
      return;
    }
    if (state.resizing && event.pointerId === state.resizing.pointerId) {
      const gap = parseFloat(getComputedStyle(dom.group).columnGap) || 34;
      const maximum = Math.max(105, dom.canvas.clientWidth - dom.chiefPlaceholder.offsetWidth - gap - 24);
      const width = clamp(state.resizing.width + (event.clientX - state.resizing.startX) / state.zoom, 105, Math.min(285, maximum));
      applySignatureBoxSize(width);
    }
  }

  function endPointerAction(event) {
    if (state.drag && event.pointerId === state.drag.pointerId) {
      const wasTap = !state.drag.moved;
      state.drag = null;
      dom.group.classList.remove('dragging');
      keepGroupInsideCanvas();
      validatePlacement(true);
      if (wasTap && event.pointerType === 'touch') {
        const now = Date.now();
        if (now - state.lastTouchTap < 420) {
          state.lastTouchTap = 0;
          togglePlacementWithLock();
        } else state.lastTouchTap = now;
      }
    }
    if (state.resizing && event.pointerId === state.resizing.pointerId) {
      state.resizing = null;
      keepGroupInsideCanvas();
      validatePlacement(true);
    }
  }

  function applySignatureBoxSize(width) {
    const height = clamp(width * .62, 105, 176);
    const imageAreaHeight = Math.max(40, height - 42);
    const visualWidth = Math.min(width, imageAreaHeight * Math.max(.12, state.signatureAspect));
    const visualHeight = visualWidth / Math.max(.12, state.signatureAspect);
    dom.professorBox.style.width = Math.round(width) + 'px';
    dom.professorBox.style.height = Math.round(height) + 'px';
    dom.professorVisual.style.width = Math.max(1, Math.round(visualWidth)) + 'px';
    dom.professorVisual.style.height = Math.max(1, Math.round(visualHeight)) + 'px';
    keepGroupInsideCanvas();
  }

  function applyChiefBoxSize(width) {
    const height = clamp(width * .62, 105, 176);
    dom.chiefPlaceholder.style.width = Math.round(width) + 'px';
    dom.chiefPlaceholder.style.height = Math.round(height) + 'px';
  }

  function initializeSignatureSizes() {
    const available = dom.canvas.clientWidth || 520;
    const width = Math.min(230, Math.max(105, (available - 62) / 2));
    applyChiefBoxSize(width);
    applySignatureBoxSize(width);
  }

  function keepGroupInsideCanvas() {
    const left = clamp(parseFloat(dom.group.style.left) || 0, 0, Math.max(0, dom.canvas.clientWidth - dom.group.offsetWidth));
    const top = clamp(parseFloat(dom.group.style.top) || 0, 0, Math.max(0, dom.canvas.clientHeight - dom.group.offsetHeight));
    setGroupPosition(left, top);
  }

  function setGroupPosition(left, top) {
    dom.group.style.left = Math.round(left) + 'px';
    dom.group.style.top = Math.round(top) + 'px';
  }

  function validatePlacement(showMessage) {
    if (!state.pdfJsDoc || !state.professorSignatureDataUrl || dom.group.classList.contains('hidden')) {
      state.placementValid = false;
      updateActionAvailability();
      return false;
    }
    const left = parseFloat(dom.group.style.left) || 0;
    const top = parseFloat(dom.group.style.top) || 0;
    const width = dom.group.offsetWidth;
    const height = dom.group.offsetHeight;
    const inside = left >= -1 && top >= -1 && left + width <= dom.canvas.clientWidth + 1 && top + height <= dom.canvas.clientHeight + 1;
    const inkRatio = inside ? underlyingInkRatio(left, top, width, height) : 1;
    state.placementValid = inside && inkRatio < .022;
    dom.group.classList.toggle('valid', state.placementValid);
    dom.group.classList.toggle('invalid', !state.placementValid);
    updateActionAvailability();

    if (showMessage) {
      if (state.placementValid) showPlacementMessage('La ubicacion no cubre contenido visible.', 'success');
      else showPlacementMessage('Mueve las firmas a un espacio libre antes de continuar.', 'error');
    }
    return state.placementValid;
  }

  function underlyingInkRatio(leftCss, topCss, widthCss, heightCss) {
    const sx = dom.canvas.width / dom.canvas.clientWidth, sy = dom.canvas.height / dom.canvas.clientHeight;
    const x0 = Math.max(0, Math.floor(leftCss * sx));
    const y0 = Math.max(0, Math.floor(topCss * sy));
    const x1 = Math.min(dom.canvas.width, Math.ceil((leftCss + widthCss) * sx));
    const y1 = Math.min(dom.canvas.height, Math.ceil((topCss + heightCss) * sy));
    if (x1 <= x0 || y1 <= y0) return 1;
    const context = dom.canvas.getContext('2d', { willReadFrequently: true });
    const imageData = context.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let dark = 0, total = 0;
    const pixelWidth = x1 - x0;
    for (let y = 0; y < y1 - y0; y += 3) {
      for (let x = 0; x < pixelWidth; x += 3) {
        const i = (y * pixelWidth + x) * 4;
        if (imageData[i] < 218 || imageData[i + 1] < 218 || imageData[i + 2] < 218) dark += 1;
        total += 1;
      }
    }
    return total ? dark / total : 1;
  }

  function confirmPlacement() {
    if (!validatePlacement(true)) return;
    state.placementConfirmed = true;
    dom.group.classList.add('confirmed');
    dom.confirmationHint.textContent = 'Ubicación confirmada · doble clic para editar';
    showPlacementMessage('Ubicacion confirmada. Ya puedes enviar el informe.', 'success');
    updateSteps();
    updateActionAvailability();
  }

  function editPlacement() {
    state.placementConfirmed = false;
    dom.group.classList.remove('confirmed');
    dom.confirmationHint.textContent = 'Doble clic para confirmar';
    updateSteps();
    updateActionAvailability();
  }

  function togglePlacementWithLock() {
    if (dom.group.dataset.confirmGestureLock === '1') return;
    dom.group.dataset.confirmGestureLock = '1';
    setTimeout(() => delete dom.group.dataset.confirmGestureLock, 450);
    state.placementConfirmed ? editPlacement() : confirmPlacement();
  }

  async function sendReport() {
    const professorName = dom.name.value.trim();
    if (!professorName) return toast('Escribe tu nombre y apellido.', 'error');
    if (!state.placementConfirmed || !validatePlacement(false)) return toast('Confirma una ubicacion valida.', 'error');

    setProcessing(true);
    try {
      const signatureResponse = await serverCall('getActiveSignatureData', state.token);
      const finalPdfBase64 = await buildSignedPdf(signatureResponse.dataUrl, signatureResponse.label);
      const response = await serverCall('saveSignedReport', {
        token: state.token,
        area: state.area,
        professorName,
        filename: state.pdfFile.name,
        base64: finalPdfBase64
      });
      rememberSentReport({ filename: response.filename, area: response.area, folder: response.folder, sentAt: new Date().toISOString() });
      dom.successCopy.textContent = `El informe fue guardado correctamente en ${response.folder}.`;
      dom.successModal.classList.remove('hidden');
      dom.send.classList.remove('processing');
    } catch (error) {
      console.error(error);
      toast(errorMessage(error), 'error', 6500);
      setProcessing(false);
    }
  }

  async function buildSignedPdf(chiefSignatureDataUrl, chiefLabel) {
    const pdfDoc = await PDFDocument.load(state.pdfBytes.slice(0));
    const pages = pdfDoc.getPages();
    const page = pages[state.pageNumber - 1];
    const professorPng = await pdfDoc.embedPng(state.professorSignatureDataUrl);
    // La administracion ya decidio si elimina o conserva el fondo blanco.
    const normalizedChief = await normalizeSignatureImage(chiefSignatureDataUrl, false, 'normal');
    const chiefPng = await pdfDoc.embedPng(normalizedChief.dataUrl);
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const scaleX = page.getWidth() / dom.canvas.clientWidth;
    const scaleY = page.getHeight() / dom.canvas.clientHeight;
    const groupLeft = dom.group.offsetLeft;
    const groupTop = dom.group.offsetTop;
    const professorRect = {
      left: groupLeft + dom.professorBox.offsetLeft + dom.professorVisual.offsetLeft,
      top: groupTop + dom.professorBox.offsetTop + dom.professorVisual.offsetTop,
      width: dom.professorVisual.offsetWidth,
      height: dom.professorVisual.offsetHeight
    };
    const chiefRect = {
      left: groupLeft + dom.chiefPlaceholder.offsetLeft,
      top: groupTop + dom.chiefPlaceholder.offsetTop,
      width: dom.chiefPlaceholder.offsetWidth,
      height: dom.chiefPlaceholder.offsetHeight
    };

    const lines = Array.isArray(chiefLabel) ? chiefLabel : state.signerLabel;
    const professorLabelRect = {
      left: groupLeft + dom.professorBox.offsetLeft,
      top: groupTop + dom.professorBox.offsetTop,
      width: dom.professorBox.offsetWidth,
      height: dom.professorBox.offsetHeight
    };
    const baseLabelFontSize = Math.max(8, 11 * scaleY);
    const longestLabel = ['FIRMA INSTRUCTOR'].concat(lines).reduce((longest, line) =>
      font.widthOfTextAtSize(String(line), 1) > font.widthOfTextAtSize(String(longest), 1) ? line : longest, '');
    const narrowestBlockWidth = Math.min(professorLabelRect.width * scaleX, chiefRect.width * scaleX);
    const sharedLabelFontSize = Math.min(baseLabelFontSize,
      narrowestBlockWidth * .94 / Math.max(1, font.widthOfTextAtSize(String(longestLabel).toUpperCase(), 1)));

    drawContainedImageFromCanvasRect(page, professorPng, professorRect, scaleX, scaleY);
    drawCenteredLabel_(page, font, ['FIRMA INSTRUCTOR'], {
      left: professorLabelRect.left, top: professorLabelRect.top,
      width: professorLabelRect.width, height: professorLabelRect.height
    }, scaleX, scaleY, sharedLabelFontSize);

    const blockX = chiefRect.left * scaleX;
    const blockTop = chiefRect.top * scaleY;
    const blockWidth = chiefRect.width * scaleX;
    const blockHeight = chiefRect.height * scaleY;
    const labelHeight = 35 * scaleY;
    const imageAreaHeight = Math.max(1, blockHeight - labelHeight - 3 * scaleY);
    const fitted = containSize(chiefPng.width, chiefPng.height, blockWidth * .88, imageAreaHeight * .88);
    const imageX = blockX + (blockWidth - fitted.width) / 2;
    const imageY = page.getHeight() - blockTop - imageAreaHeight + (imageAreaHeight - fitted.height) / 2 - 2 * scaleY;
    page.drawImage(chiefPng, { x: imageX, y: imageY, width: fitted.width, height: fitted.height });

    const lineGap = sharedLabelFontSize * 1.2;
    const labelBottom = page.getHeight() - blockTop - blockHeight + 4 * scaleY;
    lines.slice(0, 2).forEach((line, index) => {
      const safeLine = String(line || '').toUpperCase();
      const textWidth = font.widthOfTextAtSize(safeLine, sharedLabelFontSize);
      page.drawText(safeLine, {
        x: blockX + Math.max(0, (blockWidth - textWidth) / 2),
        y: labelBottom + (1 - index) * lineGap,
        size: sharedLabelFontSize,
        font,
        color: rgb(.12, .15, .19)
      });
    });

    return pdfDoc.saveAsBase64();
  }

  function drawContainedImageFromCanvasRect(page, image, rect, scaleX, scaleY) {
    const boxWidth = rect.width * scaleX, boxHeight = rect.height * scaleY;
    const fitted = containSize(image.width, image.height, boxWidth, boxHeight);
    const x = rect.left * scaleX + (boxWidth - fitted.width) / 2;
    const top = rect.top * scaleY + (boxHeight - fitted.height) / 2;
    page.drawImage(image, { x, y: page.getHeight() - top - fitted.height, width: fitted.width, height: fitted.height });
  }

  function drawCenteredLabel_(page, font, lines, rect, scaleX, scaleY, sharedFontSize) {
    const blockX = rect.left * scaleX, blockTop = rect.top * scaleY;
    const blockWidth = rect.width * scaleX, blockHeight = rect.height * scaleY;
    const fontSize = sharedFontSize || Math.max(8, 11 * scaleY), lineGap = fontSize * 1.2;
    const bottom = page.getHeight() - blockTop - blockHeight + 4 * scaleY;
    lines.forEach((line, index) => {
      const text = String(line).toUpperCase();
      const width = font.widthOfTextAtSize(text, fontSize);
      page.drawText(text, { x: blockX + Math.max(0, (blockWidth - width) / 2), y: bottom + (lines.length - 1 - index) * lineGap, size: fontSize, font, color: rgb(.12,.15,.19) });
    });
  }

  function updateChiefLabel() {
    dom.chiefLabel.textContent = state.signerLabel.join('\n');
  }

  function updateSteps() {
    const level = state.placementConfirmed ? 3 : (state.pdfFile && state.signatureFile ? 2 : 1);
    document.querySelectorAll('.step').forEach(step => {
      const number = Number(step.dataset.step);
      step.classList.toggle('active', number === level);
      step.classList.toggle('done', number < level);
    });
  }

  function updateActionAvailability() {
    const ready = Boolean(state.pdfFile && state.signatureFile && state.placementValid);
    dom.send.disabled = !(ready && state.placementConfirmed && dom.name.value.trim());
  }

  dom.name.addEventListener('input', updateActionAvailability);

  function setViewerStatus(title, subtitle) {
    dom.viewerStatus.textContent = title;
    if (subtitle) dom.pageInfo.textContent = subtitle;
  }

  function setZoom(value, updateScroll = true) {
    state.zoom = clamp(Math.round(value * 10) / 10, .7, 1.6);
    dom.canvasContainer.style.transform = `scale(${state.zoom})`;
    dom.canvasContainer.style.marginBottom = `${dom.canvasContainer.offsetHeight * (state.zoom - 1)}px`;
    dom.canvasContainer.style.marginLeft = `${Math.max(0, dom.canvasContainer.offsetWidth * (state.zoom - 1) / 2)}px`;
    dom.canvasContainer.style.marginRight = `${Math.max(0, dom.canvasContainer.offsetWidth * (state.zoom - 1) / 2)}px`;
    dom.zoomValue.textContent = Math.round(state.zoom * 100) + '%';
    dom.zoomOut.disabled = state.zoom <= .7;
    dom.zoomIn.disabled = state.zoom >= 1.6;
    if (updateScroll && state.zoom === 1) dom.viewerScroll.scrollLeft = 0;
  }

  function getRelativeGroupPosition() {
    const canvasWidth = dom.canvas.clientWidth;
    const canvasHeight = dom.canvas.clientHeight;
    if (!canvasWidth || dom.group.classList.contains('hidden')) return null;
    return {
      x: (parseFloat(dom.group.style.left) || 0) / canvasWidth,
      y: (parseFloat(dom.group.style.top) || 0) / canvasHeight
    };
  }

  function setRelativeGroupPosition(position) {
    setGroupPosition(position.x * dom.canvas.clientWidth, position.y * dom.canvas.clientHeight);
    keepGroupInsideCanvas();
    validatePlacement(false);
  }

  function showPlacementMessage(message, type) {
    dom.placementMessage.textContent = message;
    dom.placementMessage.className = 'placement-message ' + type;
    clearTimeout(showPlacementMessage.timer);
    showPlacementMessage.timer = setTimeout(() => dom.placementMessage.classList.add('hidden'), 3500);
  }

  function setProcessing(active) {
    dom.send.disabled = active;
    if (active) {
      dom.send.dataset.originalText = dom.send.textContent;
      dom.send.classList.add('processing');
    } else {
      dom.send.classList.remove('processing');
      dom.send.textContent = dom.send.dataset.originalText || 'Enviar informe firmado';
      updateActionAvailability();
    }
  }

  function serverCall(functionName, ...args) {
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${cryptoRandomId()}`;
      const iframe = document.createElement('iframe');
      const form = document.createElement('form');
      const timer = setTimeout(() => finishBackendCall(requestId, false,
        new Error('La conexión con Google tardó demasiado. Revisa tu internet e inténtalo nuevamente.')), 90000);

      iframe.name = `sigi-bridge-${requestId}`;
      iframe.hidden = true;
      iframe.setAttribute('aria-hidden', 'true');
      form.hidden = true;
      form.method = 'POST';
      form.action = BACKEND_URL;
      form.target = iframe.name;
      form.enctype = 'application/x-www-form-urlencoded';
      appendBridgeField(form, 'action', functionName);
      appendBridgeField(form, 'args', JSON.stringify(args));
      appendBridgeField(form, 'requestId', requestId);
      appendBridgeField(form, 'origin', window.location.origin);
      pendingCalls.set(requestId, { resolve, reject, timer, iframe, form });
      document.body.append(iframe, form);
      form.submit();
    });
  }

  function appendBridgeField(form, name, value) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  function receiveBackendMessage(event) {
    const message = event.data;
    if (!message || message.channel !== BRIDGE_CHANNEL || !pendingCalls.has(message.requestId)) return;
    const allowedGoogleOrigin = /^https:\/\/[a-z0-9-]+\.googleusercontent\.com$/i.test(event.origin) ||
      event.origin === 'https://script.google.com';
    if (!allowedGoogleOrigin) return;
    finishBackendCall(message.requestId, Boolean(message.ok), message.ok ? message.result : new Error(message.error || 'Error del servidor.'));
  }

  function finishBackendCall(requestId, ok, value) {
    const call = pendingCalls.get(requestId);
    if (!call) return;
    pendingCalls.delete(requestId);
    clearTimeout(call.timer);
    call.form.remove();
    call.iframe.remove();
    ok ? call.resolve(value) : call.reject(value);
  }

  function cryptoRandomId() {
    if (window.crypto && crypto.getRandomValues) {
      const values = new Uint32Array(2);
      crypto.getRandomValues(values);
      return `${values[0].toString(36)}${values[1].toString(36)}`;
    }
    return Math.random().toString(36).slice(2);
  }

  function toast(message, type = '', duration = 4200) {
    dom.toast.textContent = message;
    dom.toast.className = 'toast show ' + type;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => dom.toast.className = 'toast', duration);
  }

  function rememberSentReport(report) {
    const reports = JSON.parse(localStorage.getItem('sigiSentReports') || '[]');
    reports.unshift(report);
    localStorage.setItem('sigiSentReports', JSON.stringify(reports.slice(0, 20)));
  }

  function renderSessionHistory() {
    const reports = JSON.parse(localStorage.getItem('sigiSentReports') || '[]');
    dom.history.classList.toggle('hidden', reports.length === 0);
    dom.historyList.innerHTML = reports.map(report => {
      const time = new Date(report.sentAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
      return `<div class="history-item"><span class="history-program ${report.area.toLowerCase()}">${escapeHtml(report.area)}</span><div><strong>${escapeHtml(report.filename)}</strong><small>${escapeHtml(report.folder)} · ${time}</small></div></div>`;
    }).join('');
  }

  function returnToHome() {
    dom.successModal.classList.add('hidden');
    dom.app.classList.add('hidden');
    dom.areaScreen.classList.add('hidden');
    dom.loading.classList.remove('hidden');
    state.area = ''; state.token = ''; state.pdfFile = null; state.pdfBytes = null;
    state.pdfJsDoc = null; state.pageNumber = 0; state.signatureFile = null;
    state.signatureOriginalDataUrl = ''; state.professorSignatureDataUrl = '';
    state.placementConfirmed = false; state.placementValid = false;
    dom.name.value = ''; dom.pdfInput.value = ''; dom.signatureInput.value = '';
    dom.pdfFilename.textContent = 'Archivo PDF';
    dom.signatureFilename.textContent = 'PNG, JPG, WEBP o BMP';
    dom.removeBackground.checked = false; dom.backgroundLevel.disabled = true;
    dom.previewCard.classList.add('hidden'); dom.group.classList.add('hidden');
    dom.canvasContainer.classList.add('hidden'); dom.emptyViewer.classList.remove('hidden');
    dom.send.textContent = 'Enviar informe firmado'; dom.send.classList.remove('processing'); dom.send.disabled = true;
    setViewerStatus('Carga tu informe y firma', 'Se abrirá la última página con contenido');
    serverCall('getBootstrapData').then(onBootstrap).catch(error => fatal(errorMessage(error)));
  }

  function fatal(message) {
    dom.loading.innerHTML = `<div style="max-width:520px;text-align:center"><h2>No fue posible iniciar</h2><p>${escapeHtml(message)}</p></div>`;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  function containSize(width, height, maxWidth, maxHeight) {
    const scale = Math.min(maxWidth / width, maxHeight / height);
    return { width: width * scale, height: height * scale };
  }

  function errorMessage(error) {
    return error && (error.message || error.toString()) || 'Ocurrio un error inesperado.';
  }

  function removeAccents(value) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function debounce(fn, delay) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
  }
})();
