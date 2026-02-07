// Cache for loaded forms (to use with index-based functions)
let loadedForms = [];
let loadedExternalForms = [];

// Helper: format date with time
function formatDateWithTime(date) {
    if (!date) return '';
    const d = new Date(date);
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear();
    const hours = d.getHours().toString().padStart(2, '0');
    const mins = d.getMinutes().toString().padStart(2, '0');
    return `${day}.${month}.${year}, ${hours}:${mins}`;
}

function closeAllModals() {
    document.querySelectorAll('.modal.active').forEach(function(m) {
        m.classList.remove('active');
    });
    var actionPopup = document.getElementById('action-popup');
    if (actionPopup) actionPopup.classList.remove('active');
    document.body.classList.remove('modal-active', 'template-modal-open', 'saved-modal-open', 'settings-modal-open');
}

function isModalOpen() {
    return document.querySelector('.modal.active') !== null;
}

// Update toolbar button states based on current view
function updateToolbarState() {
    const isOnForm = !document.body.classList.contains('template-modal-open')
                  && !document.body.classList.contains('saved-modal-open')
                  && !document.body.classList.contains('settings-modal-open');

    const isSentForm = document.getElementById('sent-banner').style.display !== 'none';

    const saveBtn = document.querySelector('.btn-save');
    if (saveBtn) {
        // Disable if not on form, or if form is sent
        saveBtn.disabled = !isOnForm || isSentForm;
    }

    const exportBtn = document.querySelector('.btn-export');
    if (exportBtn) {
        exportBtn.disabled = !isOnForm;
    }
}

async function showSavedForms() {
    closeAllModals();
    window.location.hash = 'hent';
    const listEl = document.getElementById('saved-list');
    listEl.innerHTML = '<div class="no-saved">' + t('loading') + '</div>';
    document.getElementById('saved-modal').classList.add('active');
    document.body.classList.add('modal-active', 'saved-modal-open');
    updateToolbarState();
    document.getElementById('saved-list').scrollTop = 0;
    document.getElementById('external-list').scrollTop = 0;

    // Track if we need refresh when auth is ready
    pendingAuthRefresh = currentUser ? null : 'saved';

    // Åpne riktig fane basert på gjeldende skjema
    if (isExternalForm) {
        switchHentTab('external');
    }

    const saved = await getSavedForms();
    const sent = await getSentForms();
    loadedForms = saved.map(f => ({ ...f, _isSent: false })).concat(sent.map(f => ({ ...f, _isSent: true })));

    if (loadedForms.length === 0) {
        listEl.innerHTML = '<div class="no-saved">' + t('no_saved_forms') + '</div>';
    } else {
        listEl.innerHTML = loadedForms.map((item, index) => {
            const ordrenr = item.ordreseddelNr || '';
            const dato = formatDateWithTime(item.savedAt);
            const isSent = item._isSent;

            const dot = `<span class="status-dot ${isSent ? 'sent' : 'saved'}"></span>`;

            const actionBtn = isSent
                ? `<button class="saved-item-action-btn copy disabled" onclick="event.stopPropagation()" disabled title="${t('duplicate_btn')}">${copyIcon}</button>`
                : `<button class="saved-item-action-btn copy" onclick="event.stopPropagation(); duplicateForm(null, ${index})" title="${t('duplicate_btn')}">${copyIcon}</button>`;

            return `
                <div class="saved-item" onclick="loadForm(${index})">
                    <div class="saved-item-info">
                        <div class="saved-item-row1">${dot}${ordrenr || t('no_name')}</div>
                        ${dato ? `<div class="saved-item-date">${dato}</div>` : ''}
                    </div>
                    <div class="saved-item-buttons">
                        ${actionBtn}
                        <button class="saved-item-action-btn delete" onclick="event.stopPropagation(); deleteForm(null, ${index})" title="${t('delete_btn')}">${deleteIcon}</button>
                    </div>
                </div>
            `;
        }).join('');
    }
}

function setFormReadOnly(readOnly) {
    // Disable all form fields
    const fields = document.querySelectorAll('#mobile-form input, #mobile-form textarea, #mobile-form select, #form-container input, #form-container textarea, #form-container select');
    fields.forEach(el => el.disabled = readOnly);

    // Disable save button
    document.querySelector('.btn-save').disabled = readOnly;

    // Show/hide sent banner
    document.getElementById('sent-banner').style.display = readOnly ? 'block' : 'none';

    // Disable signature editing
    const signaturePreview = document.getElementById('mobile-signature-preview');
    if (signaturePreview) {
        signaturePreview.style.pointerEvents = readOnly ? 'none' : '';
        signaturePreview.style.opacity = readOnly ? '0.6' : '';
    }

    // Disable "add order" button
    const addOrderBtn = document.querySelector('.mobile-add-line-btn');
    if (addOrderBtn) {
        addOrderBtn.disabled = readOnly;
        addOrderBtn.style.opacity = readOnly ? '0.5' : '';
    }

    // Disable all "delete order" buttons
    document.querySelectorAll('.mobile-order-header-delete').forEach(btn => {
        btn.disabled = readOnly;
        btn.style.opacity = readOnly ? '0.3' : '';
        btn.style.pointerEvents = readOnly ? 'none' : '';
    });

    // Disable all "add material" buttons
    document.querySelectorAll('.mobile-add-mat-btn').forEach(btn => {
        btn.disabled = readOnly;
        btn.style.opacity = readOnly ? '0.5' : '';
    });

    // Disable clicking on material rows to edit
    document.querySelectorAll('.mobile-material-row').forEach(row => {
        row.style.pointerEvents = readOnly ? 'none' : '';
    });
}

function loadForm(index) {
    if (loadedForms[index]) {
        setFormData(loadedForms[index]);
        lastSavedData = getFormDataSnapshot();
        const isSent = !!loadedForms[index]._isSent;
        setFormReadOnly(isSent);
        sessionStorage.setItem('firesafe_current_sent', isSent ? '1' : '');
        closeModal();
        // Set hash based on form type
        window.location.hash = isExternalForm ? 'ekstern' : 'skjema';
        sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
        // Update form header title
        document.getElementById('form-header-title').textContent = t(isExternalForm ? 'external_form_title' : 'form_title');
        window.scrollTo(0, 0);
    }
}

async function duplicateForm(event, index) {
    if (event) event.stopPropagation();
    const form = loadedForms[index];
    if (!form) return;

    setFormData(form);
    // Tøm ordrenummer og sett nytt
    document.getElementById('ordreseddel-nr').value = '';
    document.getElementById('mobile-ordreseddel-nr').value = '';
    isExternalForm = false;
    updateExternalBadge();
    await autoFillOrderNumber();

    // Sett uke til nåværende
    const now = new Date();
    const week = 'Uke ' + getWeekNumber(now);
    document.getElementById('dato').value = week;
    document.getElementById('mobile-dato').value = week;

    // Sett signeringsdato til i dag
    const today = formatDate(now);
    document.getElementById('signering-dato').value = today;
    document.getElementById('mobile-signering-dato').value = today;

    // Tøm kundens underskrift
    document.getElementById('kundens-underskrift').value = '';
    document.getElementById('mobile-kundens-underskrift').value = '';
    clearSignaturePreview();

    // Reset bestillinger til 1 tomt ordrekort
    const container = document.getElementById('mobile-orders');
    container.innerHTML = '';
    container.appendChild(createOrderCard({ description: '', materials: [], timer: '' }, true));
    updateOrderDeleteStates();
    document.getElementById('work-lines').innerHTML = '';

    lastSavedData = null;
    setFormReadOnly(false);
    closeModal();
    // Duplicated form is always regular (not external)
    window.location.hash = 'skjema';
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    // Update form header title
    document.getElementById('form-header-title').textContent = t('form_title');
    window.scrollTo(0, 0);
    showNotificationModal(t('duplicated_success'), true);
}

function deleteForm(event, index) {
    if (event) event.stopPropagation();
    const form = loadedForms[index];
    if (!form) return;
    const isSent = form._isSent;
    const confirmMsg = isSent ? t('delete_sent_confirm') : t('delete_confirm');

    showConfirmModal(confirmMsg, async function() {
        const col = isSent ? 'archive' : 'forms';
        const lsKey = isSent ? ARCHIVE_KEY : STORAGE_KEY;

        if (currentUser && db) {
            try {
                await db.collection('users').doc(currentUser.uid).collection(col).doc(form.id).delete();
            } catch (e) {
                console.error('Delete error:', e);
            }
        } else {
            const list = JSON.parse(localStorage.getItem(lsKey) || '[]');
            const idx = list.findIndex(f => f.id === form.id);
            if (idx !== -1) {
                list.splice(idx, 1);
                localStorage.setItem(lsKey, JSON.stringify(list));
            }
        }
        showSavedForms();
    });
}

function closeModal() {
    document.getElementById('saved-modal').classList.remove('active');
    document.body.classList.remove('modal-active', 'saved-modal-open');
    updateToolbarState();
    document.getElementById('saved-search').value = '';
    document.getElementById('external-search').value = '';
    // Reset to own tab
    switchHentTab('own');
    // Clear URL hash
    history.replaceState(null, '', window.location.pathname);
}

function switchHentTab(tab) {
    const tabs = document.querySelectorAll('#saved-modal .modal-tab');
    tabs.forEach(t => t.classList.remove('active'));

    const savedList = document.getElementById('saved-list');
    const externalList = document.getElementById('external-list');
    const ownSearch = document.getElementById('own-search-wrap');
    const externalSearch = document.getElementById('external-search-wrap');

    savedList.style.display = 'none';
    externalList.style.display = 'none';
    ownSearch.style.display = 'none';
    externalSearch.style.display = 'none';

    if (tab === 'own') {
        tabs[0].classList.add('active');
        savedList.style.display = '';
        ownSearch.style.display = '';
        savedList.scrollTop = 0;
    } else if (tab === 'external') {
        tabs[1].classList.add('active');
        externalList.style.display = '';
        externalSearch.style.display = '';
        externalList.scrollTop = 0;
        loadExternalTab();
    }
}

// Action popup
function showItemMenu(event, type, index, isSent) {
    event.stopPropagation();
    var actions = [];
    var title = '';
    if (type === 'form') {
        var form = loadedForms[index];
        if (form) title = form.ordreseddelNr || '';
        if (isSent) {
            actions.push({ label: t('sent_banner_move'), onclick: 'moveToSaved(null, ' + index + ')' });
        } else {
            actions.push({ label: t('duplicate_btn'), onclick: 'duplicateForm(null, ' + index + ')' });
        }
        actions.push({ label: t('delete_btn'), onclick: 'deleteForm(null, ' + index + ')', disabled: isSent });
    } else if (type === 'external') {
        var extForm = loadedExternalForms[index];
        if (extForm) title = extForm.ordreseddelNr || '';
        actions.push({ label: t('delete_btn'), onclick: 'deleteExternalForm(null, ' + index + ')' });
    } else if (type === 'template') {
        var tmpl = loadedTemplates[index];
        if (tmpl) {
            title = [tmpl.prosjektnavn, tmpl.oppdragsgiver, tmpl.prosjektnr].filter(function(x) { return x; }).join(' • ');
        }
        actions.push({ label: t('duplicate_btn'), onclick: 'duplicateTemplate(' + index + ')' });
        actions.push({ label: t('delete_btn'), onclick: 'deleteTemplate(null, ' + index + ')' });
    }
    showActionPopup(title, actions);
}

function showActionPopup(title, actions) {
    const popup = document.getElementById('action-popup');
    var titleEl = document.getElementById('action-popup-title');
    titleEl.textContent = title;
    titleEl.style.display = title ? '' : 'none';
    const buttonsEl = document.getElementById('action-popup-buttons');
    buttonsEl.innerHTML = actions.map((a, i) =>
        `<div class="confirm-modal-buttons"${i > 0 ? ' style="margin-top:8px"' : ''}><button class="confirm-btn-ok" style="background:#2c3e50;flex:1${a.disabled ? ';opacity:0.4;pointer-events:none' : ''}" onclick="${a.onclick}; closeActionPopup()"${a.disabled ? ' disabled' : ''}>${a.label}</button></div>`
    ).join('') +
    '<div class="confirm-modal-buttons" style="margin-top:4px"><button class="confirm-btn-cancel" style="flex:1" onclick="closeActionPopup()">' + t('btn_cancel') + '</button></div>';
    popup.classList.add('active');
}

function closeActionPopup(e) {
    if (e && e.target !== document.getElementById('action-popup')) return;
    document.getElementById('action-popup').classList.remove('active');
}

function showSaveMenu() {
    if (isModalOpen()) return;
    showActionPopup(t('save_menu_title'), [
        { label: t('save_option'), onclick: 'saveForm()' },
        { label: t('save_as_template'), onclick: 'saveAsTemplate()' }
    ]);
}

// Keep old names for compatibility
function closeSaveMenu() { closeActionPopup(); }
function closeExportMenu() { closeActionPopup(); }
function showExportMenu() {
    if (isModalOpen()) return;
    const isSent = document.getElementById('sent-banner').style.display !== 'none';
    const popup = document.getElementById('action-popup');
    document.getElementById('action-popup-title').textContent = t('export_title');
    const buttonsEl = document.getElementById('action-popup-buttons');
    let html = '';
    if (!isSent) {
        html += '<div style="font-size:12px;color:#888;margin-bottom:4px;">' + t('export_only_label') + '</div>';
    }
    html += '<div class="confirm-modal-buttons">' +
            '<button class="confirm-btn-ok" style="background:#2c3e50" onclick="doExportPDF(); closeActionPopup()">PDF</button>' +
            '<button class="confirm-btn-ok" style="background:#2c3e50" onclick="doExportPNG(); closeActionPopup()">PNG</button>' +
        '</div>';
    if (!isSent) {
        html += '<div style="font-size:12px;color:#888;margin:10px 0 4px;">' + t('export_and_mark_label') + '</div>' +
            '<div class="confirm-modal-buttons">' +
                '<button class="confirm-btn-ok" style="background:#E8501A" onclick="markAsSentAndExport(\'pdf\'); closeActionPopup()">PDF</button>' +
                '<button class="confirm-btn-ok" style="background:#E8501A" onclick="markAsSentAndExport(\'png\'); closeActionPopup()">PNG</button>' +
            '</div>';
    }
    html += '<div class="confirm-modal-buttons" style="margin-top:10px"><button class="confirm-btn-cancel" style="flex:1" onclick="closeActionPopup()">' + t('btn_cancel') + '</button></div>';
    buttonsEl.innerHTML = html;
    popup.classList.add('active');
}

function filterOwnForms() {
    const searchTerm = document.getElementById('saved-search').value.toLowerCase().trim();
    const items = document.querySelectorAll('#saved-list .saved-item');
    items.forEach(item => {
        const ordrenr = item.querySelector('.saved-item-row1')?.textContent.toLowerCase() || '';
        item.style.display = ordrenr.startsWith(searchTerm) ? 'flex' : 'none';
    });
}

async function markAsSent() {
    const ordrenr = document.getElementById('ordreseddel-nr').value || document.getElementById('mobile-ordreseddel-nr').value;
    if (!ordrenr) return;

    const formsCol = isExternalForm ? 'external' : 'forms';
    const archiveCol = isExternalForm ? 'externalArchive' : 'archive';
    const sKey = isExternalForm ? EXTERNAL_KEY : STORAGE_KEY;
    const aKey = isExternalForm ? EXTERNAL_ARCHIVE_KEY : ARCHIVE_KEY;

    const saved = isExternalForm ? await getExternalForms() : await getSavedForms();
    const formIndex = saved.findIndex(f => f.ordreseddelNr === ordrenr);

    if (formIndex !== -1) {
        // Skjemaet er lagret — flytt fra lagrede til sendte
        const form = saved[formIndex];
        if (currentUser && db) {
            try {
                await db.collection('users').doc(currentUser.uid).collection(archiveCol).doc(form.id).set(form);
                await db.collection('users').doc(currentUser.uid).collection(formsCol).doc(form.id).delete();
            } catch (e) {
                console.error('Mark as sent error:', e);
            }
        } else {
            const localSaved = JSON.parse(localStorage.getItem(sKey) || '[]');
            const archived = JSON.parse(localStorage.getItem(aKey) || '[]');
            const f = localSaved.splice(formIndex, 1)[0];
            archived.unshift(f);
            localStorage.setItem(sKey, JSON.stringify(localSaved));
            localStorage.setItem(aKey, JSON.stringify(archived));
        }
    } else {
        // Skjemaet er ikke lagret ennå — lagre direkte til sendte
        const data = getFormData();
        data.id = Date.now().toString();
        if (currentUser && db) {
            try {
                await db.collection('users').doc(currentUser.uid).collection(archiveCol).doc(data.id).set(data);
            } catch (e) {
                console.error('Mark as sent error:', e);
            }
        } else {
            const archived = JSON.parse(localStorage.getItem(aKey) || '[]');
            archived.unshift(data);
            localStorage.setItem(aKey, JSON.stringify(archived));
        }
    }

    lastSavedData = getFormDataSnapshot();
    showNotificationModal(t('marked_as_sent'), true);
}

async function moveCurrentToSaved() {
    const ordrenr = document.getElementById('ordreseddel-nr').value || document.getElementById('mobile-ordreseddel-nr').value;
    if (!ordrenr) return;

    const formsCol = isExternalForm ? 'external' : 'forms';
    const archiveCol = isExternalForm ? 'externalArchive' : 'archive';
    const sKey = isExternalForm ? EXTERNAL_KEY : STORAGE_KEY;
    const aKey = isExternalForm ? EXTERNAL_ARCHIVE_KEY : ARCHIVE_KEY;

    const sent = isExternalForm ? await getExternalSentForms() : await getSentForms();
    const formIndex = sent.findIndex(f => f.ordreseddelNr === ordrenr);
    if (formIndex === -1) return;

    const form = sent[formIndex];

    if (currentUser && db) {
        try {
            await db.collection('users').doc(currentUser.uid).collection(formsCol).doc(form.id).set(form);
            await db.collection('users').doc(currentUser.uid).collection(archiveCol).doc(form.id).delete();
        } catch (e) {
            console.error('Move to saved error:', e);
        }
    } else {
        const archived = JSON.parse(localStorage.getItem(aKey) || '[]');
        const saved = JSON.parse(localStorage.getItem(sKey) || '[]');
        const f = archived.splice(formIndex, 1)[0];
        saved.unshift(f);
        localStorage.setItem(aKey, JSON.stringify(archived));
        localStorage.setItem(sKey, JSON.stringify(saved));
    }

    setFormReadOnly(false);
    showNotificationModal(t('move_to_saved_success'), true);
}

function moveToSaved(event, index) {
    if (event) event.stopPropagation();
    showConfirmModal(t('move_to_saved_confirm'), async function() {
        const form = loadedForms[index];
        if (!form) return;

        if (currentUser && db) {
            try {
                await db.collection('users').doc(currentUser.uid).collection('forms').doc(form.id).set(form);
                await db.collection('users').doc(currentUser.uid).collection('archive').doc(form.id).delete();
            } catch (e) {
                console.error('Restore error:', e);
            }
        } else {
            const archived = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            const idx = archived.findIndex(f => f.id === form.id);
            if (idx !== -1) {
                const f = archived.splice(idx, 1)[0];
                saved.unshift(f);
                localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archived));
                localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
            }
        }

        // Hvis det åpne skjemaet er det som ble flyttet, fjern sendt-modus
        const currentOrdrenr = document.getElementById('mobile-ordreseddel-nr').value;
        if (currentOrdrenr && form.ordreseddelNr === currentOrdrenr) {
            setFormReadOnly(false);
        }

        await showSavedForms();
        showNotificationModal(t('move_to_saved_success'), true);
    }, t('btn_move'), '#333');
}

// === External forms tab ===

async function loadExternalTab() {
    const listEl = document.getElementById('external-list');
    listEl.innerHTML = '<div class="no-saved">' + t('loading') + '</div>';

    const forms = await getExternalForms();
    const sentForms = await getExternalSentForms();
    loadedExternalForms = forms.concat(sentForms.map(f => ({ ...f, _isSent: true })));

    if (loadedExternalForms.length === 0) {
        listEl.innerHTML = '<div class="no-saved">' + t('no_external_forms') + '</div>';
    } else {
        listEl.innerHTML = loadedExternalForms.map((item, index) => {
            const ordrenr = item.ordreseddelNr || '';
            const dato = formatDateWithTime(item.savedAt);
            const isSent = item._isSent;

            const dot = `<span class="status-dot ${isSent ? 'sent' : 'saved'}"></span>`;

            return `
                <div class="saved-item" onclick="loadExternalForm(${index})">
                    <div class="saved-item-info">
                        <div class="saved-item-row1">${dot}${ordrenr || t('no_name')}</div>
                        ${dato ? `<div class="saved-item-date">${dato}</div>` : ''}
                    </div>
                    <div class="saved-item-buttons">
                        <button class="saved-item-action-btn delete" onclick="event.stopPropagation(); deleteExternalForm(null, ${index})" title="${t('delete_btn')}">${deleteIcon}</button>
                    </div>
                </div>
            `;
        }).join('');
    }
}

function loadExternalForm(index) {
    const form = loadedExternalForms[index];
    if (!form) return;
    setFormData(form);
    lastSavedData = getFormDataSnapshot();
    const isSent = !!form._isSent;
    setFormReadOnly(isSent);
    sessionStorage.setItem('firesafe_current_sent', isSent ? '1' : '');
    closeModal();
    // External form = #ekstern
    window.location.hash = 'ekstern';
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    // Update form header title
    document.getElementById('form-header-title').textContent = t('external_form_title');
    window.scrollTo(0, 0);
}

function deleteExternalForm(event, index) {
    if (event) event.stopPropagation();
    const form = loadedExternalForms[index];
    if (!form) return;
    const isSent = form._isSent;
    const confirmMsg = isSent ? t('delete_sent_confirm') : t('delete_confirm');

    showConfirmModal(confirmMsg, async function() {
        const col = isSent ? 'externalArchive' : 'external';
        const lsKey = isSent ? EXTERNAL_ARCHIVE_KEY : EXTERNAL_KEY;

        if (currentUser && db) {
            try {
                await db.collection('users').doc(currentUser.uid).collection(col).doc(form.id).delete();
            } catch (e) {
                console.error('Delete external error:', e);
            }
        } else {
            const list = JSON.parse(localStorage.getItem(lsKey) || '[]');
            const idx = list.findIndex(f => f.id === form.id);
            if (idx !== -1) {
                list.splice(idx, 1);
                localStorage.setItem(lsKey, JSON.stringify(list));
            }
        }
        loadExternalTab();
    });
}

function filterExternalForms() {
    const searchTerm = document.getElementById('external-search').value.toLowerCase().trim();
    const items = document.querySelectorAll('#external-list .saved-item');
    items.forEach(item => {
        const ordrenr = item.querySelector('.saved-item-row1')?.textContent.toLowerCase() || '';
        item.style.display = ordrenr.startsWith(searchTerm) ? 'flex' : 'none';
    });
}

function closeSentModal() {
    closeModal();
}

// ============================================
// PROSJEKTMALER
// ============================================

let loadedTemplates = [];

async function getTemplates() {
    if (currentUser && db) {
        try {
            const snapshot = await db.collection('users').doc(currentUser.uid).collection('templates').orderBy('prosjektnavn').get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (e) {
            console.error('Templates error:', e);
            return JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]');
        }
    }
    return JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]');
}

async function saveAsTemplate() {
    // Sync mobile to original first
    if (isMobile()) {
        syncMobileToOriginal();
    }

    const prosjektnavn = document.getElementById('prosjektnavn').value.trim();
    if (!prosjektnavn) {
        showNotificationModal(t('template_name_required'));
        return;
    }

    const templateData = {
        prosjektnavn: prosjektnavn,
        prosjektnr: document.getElementById('prosjektnr').value.trim(),
        oppdragsgiver: document.getElementById('oppdragsgiver').value.trim(),
        avdeling: document.getElementById('avdeling').value.trim(),
        sted: document.getElementById('sted').value.trim(),
        createdAt: new Date().toISOString(),
        createdBy: currentUser ? currentUser.uid : 'local'
    };

    if (currentUser && db) {
        try {
            const templatesRef = db.collection('users').doc(currentUser.uid).collection('templates');
            const docId = Date.now().toString();
            await templatesRef.doc(docId).set(templateData);
            showNotificationModal(t('template_save_success'), true);
        } catch (e) {
            console.error('Save template error:', e);
            showNotificationModal(t('template_save_error') + e.message);
        }
    } else {
        const templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]');
        templateData.id = Date.now().toString();
        templates.push(templateData);
        localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
        showNotificationModal(t('template_save_success'), true);
    }
}

async function showTemplateModal() {
    closeAllModals();
    // No hash - template modal is the home page
    history.replaceState(null, '', window.location.pathname);
    const listEl = document.getElementById('template-list');
    listEl.innerHTML = '<div class="no-saved">' + t('loading') + '</div>';
    document.getElementById('template-modal').classList.add('active');
    document.body.classList.add('modal-active', 'template-modal-open');
    updateToolbarState();

    // Track if we need refresh when auth is ready
    pendingAuthRefresh = currentUser ? null : 'templates';

    const templates = await getTemplates();
    loadedTemplates = templates;

    if (templates.length === 0) {
        listEl.innerHTML = '<div class="no-saved">' + t('no_templates') + '</div>';
    } else {
        listEl.innerHTML = templates.map((item, index) => {
            const row1 = item.prosjektnavn || t('no_name');
            const row2 = [item.oppdragsgiver, item.prosjektnr].filter(x => x).join(' • ');

            return `
                <div class="saved-item" onclick="loadTemplate(${index})">
                    <div class="saved-item-info">
                        <div class="saved-item-row1">${row1}</div>
                        ${row2 ? `<div class="saved-item-row2">${row2}</div>` : ''}
                    </div>
                    <div class="saved-item-buttons">
                        <button class="saved-item-action-btn delete" onclick="event.stopPropagation(); deleteTemplate(null, ${index})" title="${t('delete_btn')}">${deleteIcon}</button>
                    </div>
                </div>
            `;
        }).join('');
    }
}

async function autoFillOrderNumber() {
    const nextNr = await getNextOrderNumber();
    if (nextNr !== null) {
        document.getElementById('ordreseddel-nr').value = nextNr;
        document.getElementById('mobile-ordreseddel-nr').value = nextNr;
    }
}

function loadTemplate(index) {
    const template = loadedTemplates[index];
    if (!template) return;

    preNewFormData = null;
    clearForm();
    setFormReadOnly(false);

    // Fill the 5 fields in both forms
    document.getElementById('oppdragsgiver').value = template.oppdragsgiver || '';
    document.getElementById('prosjektnr').value = template.prosjektnr || '';
    document.getElementById('prosjektnavn').value = template.prosjektnavn || '';
    document.getElementById('avdeling').value = template.avdeling || '';
    document.getElementById('sted').value = template.sted || '';

    document.getElementById('mobile-oppdragsgiver').value = template.oppdragsgiver || '';
    document.getElementById('mobile-prosjektnr').value = template.prosjektnr || '';
    document.getElementById('mobile-prosjektnavn').value = template.prosjektnavn || '';
    document.getElementById('mobile-avdeling').value = template.avdeling || '';
    document.getElementById('mobile-sted').value = template.sted || '';

    autoFillOrderNumber();

    document.getElementById('template-modal').classList.remove('active');
    document.body.classList.remove('modal-active', 'template-modal-open');
    updateToolbarState();
    document.getElementById('template-search').value = '';
    // Template loaded = regular form
    window.location.hash = 'skjema';
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    // Update form header title
    document.getElementById('form-header-title').textContent = t('form_title');
    window.scrollTo(0, 0);
}

function deleteTemplate(event, index) {
    if (event) event.stopPropagation();
    showConfirmModal(t('template_delete_confirm'), async function() {
        const template = loadedTemplates[index];
        if (!template) return;

        if (currentUser && db) {
            try {
                await db.collection('users').doc(currentUser.uid).collection('templates').doc(template.id).delete();
            } catch (e) {
                console.error('Delete template error:', e);
            }
        } else {
            const templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]');
            const idx = templates.findIndex(t => t.id === template.id);
            if (idx !== -1) {
                templates.splice(idx, 1);
                localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
            }
        }
        showTemplateModal();
    });
}

async function duplicateTemplate(index) {
    const template = loadedTemplates[index];
    if (!template) return;

    const copy = Object.assign({}, template);
    copy.prosjektnavn = (copy.prosjektnavn || '') + ' (kopi)';
    copy.createdAt = new Date().toISOString();

    if (currentUser && db) {
        try {
            const docId = Date.now().toString();
            copy.id = docId;
            await db.collection('users').doc(currentUser.uid).collection('templates').doc(docId).set(copy);
        } catch (e) {
            console.error('Duplicate template error:', e);
            showNotificationModal(t('template_save_error') + e.message);
            return;
        }
    } else {
        copy.id = Date.now().toString();
        const templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]');
        templates.push(copy);
        localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
    }
    showNotificationModal(t('duplicated_success'), true);
    showTemplateModal();
}

function closeTemplateModal() {
    // Always clear and initialize form for blank form
    clearForm();
    preNewFormData = null;
    setFormReadOnly(false);
    autoFillOrderNumber();
    autoFillDefaults();

    document.getElementById('template-modal').classList.remove('active');
    document.body.classList.remove('modal-active', 'template-modal-open');
    updateToolbarState();
    document.getElementById('template-search').value = '';
    // Blank form = #skjema
    window.location.hash = 'skjema';
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    // Update form header title
    document.getElementById('form-header-title').textContent = t('form_title');
}

function goToHome() {
    // Go to template modal (home)
    history.replaceState(null, '', window.location.pathname);
    showTemplateModal();
}

function cancelTemplateModal() {
    if (preNewFormData) {
        setFormData(preNewFormData);
        preNewFormData = null;
        // Return to the form they were on
        window.location.hash = isExternalForm ? 'ekstern' : 'skjema';
    }
    // If no preNewFormData, stay at home (no hash)
    document.getElementById('template-modal').classList.remove('active');
    document.body.classList.remove('modal-active', 'template-modal-open');
    updateToolbarState();
    document.getElementById('template-search').value = '';
}

function filterTemplates() {
    const searchTerm = document.getElementById('template-search').value.toLowerCase().trim();
    const items = document.querySelectorAll('#template-list .saved-item');
    items.forEach(item => {
        const prosjektnavn = item.querySelector('.saved-item-row1')?.textContent.toLowerCase() || '';
        item.style.display = prosjektnavn.startsWith(searchTerm) ? 'flex' : 'none';
    });
}

// ============================================
// ORDRESEDDELNUMMER INNSTILLINGER
// ============================================

// In-memory ranges for settings modal editing
let settingsRanges = [];
let settingsGivenAway = [];

async function getOrderNrSettings() {
    let data = null;
    if (currentUser && db) {
        try {
            const doc = await db.collection('users').doc(currentUser.uid).collection('settings').doc('ordrenr').get();
            if (doc.exists) data = doc.data();
        } catch (e) {
            console.error('Settings error:', e);
        }
    }
    if (!data) {
        const stored = localStorage.getItem(SETTINGS_KEY);
        data = stored ? JSON.parse(stored) : null;
    }
    // Backward compat: convert old {nrStart, nrEnd} to {ranges}
    if (data && !data.ranges && data.nrStart != null) {
        data = { ranges: [{ start: data.nrStart, end: data.nrEnd }] };
    }
    if (data && !data.givenAway) data.givenAway = [];
    return data;
}

function buildOrderNrSettings() {
    return { ranges: settingsRanges.slice(), givenAway: settingsGivenAway.slice() };
}

function getSettingsPageTitle(page) {
    const titles = {
        ordrenr: t('settings_ordrenr'),
        defaults: t('settings_defaults'),
        language: t('settings_language'),
        materials: t('settings_materials')
    };
    return titles[page] || '';
}

async function showSettingsModal() {
    closeAllModals();
    window.location.hash = 'settings';
    showSettingsMenu();
    document.getElementById('settings-modal').classList.add('active');
    document.body.classList.add('modal-active', 'settings-modal-open');
    updateToolbarState();
}

function closeSettingsModal() {
    document.getElementById('settings-modal').classList.remove('active');
    document.body.classList.remove('modal-active', 'settings-modal-open');
    updateToolbarState();
    showSettingsMenu();
    // Clear URL hash
    history.replaceState(null, '', window.location.pathname);
}

function showSettingsMenu() {
    document.querySelectorAll('.settings-page').forEach(p => p.style.display = 'none');
    document.getElementById('settings-page-menu').style.display = 'block';
    document.getElementById('settings-header-title').textContent = t('settings_title');
    document.body.classList.remove('settings-subpage-open');
    const header = document.getElementById('settings-header');
    const existingBack = header.querySelector('.settings-back-btn');
    if (existingBack) existingBack.remove();
}

async function showSettingsPage(page) {
    document.querySelectorAll('.settings-page').forEach(p => p.style.display = 'none');
    document.getElementById('settings-page-' + page).style.display = 'block';
    document.getElementById('settings-header-title').textContent = getSettingsPageTitle(page);
    document.body.classList.add('settings-subpage-open');

    const header = document.getElementById('settings-header');
    if (!header.querySelector('.settings-back-btn')) {
        const backBtn = document.createElement('button');
        backBtn.className = 'settings-back-btn';
        backBtn.innerHTML = '&lsaquo;';
        backBtn.onclick = showSettingsMenu;
        header.insertBefore(backBtn, header.firstChild);
    }

    if (page === 'ordrenr') {
        const settings = await getOrderNrSettings();
        settingsRanges = (settings && settings.ranges) ? settings.ranges.slice() : [];
        settingsGivenAway = (settings && settings.givenAway) ? settings.givenAway.slice() : [];
        renderSettingsRanges();
        renderGivenAwayRanges();
        document.getElementById('settings-new-start').value = '';
        document.getElementById('settings-new-end').value = '';
        document.getElementById('settings-give-start').value = '';
        document.getElementById('settings-give-end').value = '';
        updateSettingsStatus();
    } else if (page === 'defaults') {
        await loadDefaultSettingsToModal();
    } else if (page === 'language') {
        document.getElementById('lang-check-no').textContent = currentLang === 'no' ? '\u2713' : '';
        document.getElementById('lang-check-en').textContent = currentLang === 'en' ? '\u2713' : '';
    } else if (page === 'materials') {
        await loadMaterialSettingsToModal();
    }
}

// ============================================
// MATERIALER OG ENHETER INNSTILLINGER
// ============================================

let settingsMaterials = [];
let settingsUnits = [];

function normalizeMaterialData(data) {
    if (!data) return { materials: [], units: [] };
    let materials = data.materials || [];
    if (materials.length > 0 && typeof materials[0] === 'string') {
        materials = materials.map(name => ({ name: name, needsSpec: false }));
    }
    return { materials, units: data.units || [] };
}

async function getMaterialSettings() {
    if (currentUser && db) {
        try {
            const doc = await db.collection('settings').doc('materials').get();
            if (doc.exists) return normalizeMaterialData(doc.data());
        } catch (e) {
            console.error('Materials settings error:', e);
        }
    }
    const stored = localStorage.getItem(MATERIALS_KEY);
    return normalizeMaterialData(stored ? JSON.parse(stored) : null);
}

async function saveMaterialSettings() {
    const data = { materials: settingsMaterials.map(m => ({ name: m.name, needsSpec: !!m.needsSpec })), units: settingsUnits.slice() };
    if (currentUser && db) {
        try {
            await db.collection('settings').doc('materials').set(data);
        } catch (e) {
            console.error('Save materials settings error:', e);
        }
    }
    localStorage.setItem(MATERIALS_KEY, JSON.stringify(data));
    // Refresh dropdown cache
    cachedMaterialOptions = data.materials.slice();
    cachedUnitOptions = settingsUnits.slice();
}

async function loadMaterialSettingsToModal() {
    const data = await getMaterialSettings();
    settingsMaterials = (data && data.materials) ? data.materials.slice() : [];
    settingsUnits = (data && data.units) ? data.units.slice() : [];
    settingsMaterials.sort((a, b) => a.name.localeCompare(b.name, 'no'));
    sortAlpha(settingsUnits);
    renderMaterialSettingsItems();
    renderUnitSettingsItems();
    document.getElementById('settings-new-material').value = '';
    document.getElementById('settings-new-unit').value = '';
}

function renderMaterialSettingsItems() {
    const container = document.getElementById('settings-material-items');
    if (settingsMaterials.length === 0) {
        container.innerHTML = '<div style="font-size:13px;color:#999;margin-bottom:8px;">' + t('settings_no_materials') + '</div>';
        return;
    }
    container.innerHTML = settingsMaterials.map((item, idx) =>
        `<div class="settings-list-item"><span onclick="editSettingsMaterial(${idx})">${item.name}</span><button class="settings-spec-toggle${item.needsSpec ? ' active' : ''}" onclick="toggleMaterialSpec(${idx})" title="${t('settings_spec_toggle')}">Spec</button><button class="settings-delete-btn" onclick="removeSettingsMaterial(${idx})" title="${t('btn_remove')}">${deleteIcon}</button></div>`
    ).join('');
}

function renderUnitSettingsItems() {
    const container = document.getElementById('settings-unit-items');
    if (settingsUnits.length === 0) {
        container.innerHTML = '<div style="font-size:13px;color:#999;margin-bottom:8px;">' + t('settings_no_units') + '</div>';
        return;
    }
    container.innerHTML = settingsUnits.map((item, idx) =>
        `<div class="settings-list-item"><span onclick="editSettingsUnit(${idx})">${item}</span><button class="settings-delete-btn" onclick="removeSettingsUnit(${idx})" title="${t('btn_remove')}">${deleteIcon}</button></div>`
    ).join('');
}

function toggleSettingsSection(section) {
    const body = document.getElementById('settings-body-' + section);
    const arrow = document.getElementById('settings-arrow-' + section);
    body.classList.toggle('open');
    arrow.classList.toggle('open');
}

async function addSettingsMaterial() {
    const input = document.getElementById('settings-new-material');
    const val = input.value.trim();
    if (!val) return;
    if (settingsMaterials.some(m => m.name.toLowerCase() === val.toLowerCase())) {
        showNotificationModal(t('settings_material_exists'));
        return;
    }
    settingsMaterials.push({ name: val, needsSpec: false });
    settingsMaterials.sort((a, b) => a.name.localeCompare(b.name, 'no'));
    input.value = '';
    renderMaterialSettingsItems();
    await saveMaterialSettings();
    showNotificationModal(t('settings_material_added'), true);
}

async function addSettingsUnit() {
    const input = document.getElementById('settings-new-unit');
    const val = input.value.trim();
    if (!val) return;
    if (settingsUnits.some(u => u.toLowerCase() === val.toLowerCase())) {
        showNotificationModal(t('settings_unit_exists'));
        return;
    }
    settingsUnits.push(val);
    sortAlpha(settingsUnits);
    input.value = '';
    renderUnitSettingsItems();
    await saveMaterialSettings();
    showNotificationModal(t('settings_unit_added'), true);
}

function removeSettingsMaterial(idx) {
    const item = settingsMaterials[idx];
    showConfirmModal(t('settings_material_remove', item.name), async function() {
        settingsMaterials.splice(idx, 1);
        renderMaterialSettingsItems();
        await saveMaterialSettings();
    });
}

function removeSettingsUnit(idx) {
    const item = settingsUnits[idx];
    showConfirmModal(t('settings_material_remove', item), async function() {
        settingsUnits.splice(idx, 1);
        renderUnitSettingsItems();
        await saveMaterialSettings();
    });
}

function editSettingsMaterial(idx) {
    const container = document.getElementById('settings-material-items');
    const item = container.children[idx];
    const span = item.querySelector('span');
    const oldVal = settingsMaterials[idx].name;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'settings-list-edit-input';
    input.value = oldVal;
    span.replaceWith(input);
    input.focus();
    input.select();
    let saved = false;
    async function save() {
        if (saved) return;
        saved = true;
        const newVal = input.value.trim();
        if (!newVal || newVal === oldVal) {
            renderMaterialSettingsItems();
            return;
        }
        if (settingsMaterials.some((m, i) => i !== idx && m.name.toLowerCase() === newVal.toLowerCase())) {
            showNotificationModal(t('settings_material_exists'));
            renderMaterialSettingsItems();
            return;
        }
        settingsMaterials[idx].name = newVal;
        settingsMaterials.sort((a, b) => a.name.localeCompare(b.name, 'no'));
        renderMaterialSettingsItems();
        await saveMaterialSettings();
    }
    input.addEventListener('blur', save);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { saved = true; renderMaterialSettingsItems(); }
    });
}

async function toggleMaterialSpec(idx) {
    settingsMaterials[idx].needsSpec = !settingsMaterials[idx].needsSpec;
    renderMaterialSettingsItems();
    await saveMaterialSettings();
}

function editSettingsUnit(idx) {
    const container = document.getElementById('settings-unit-items');
    const item = container.children[idx];
    const span = item.querySelector('span');
    const oldVal = settingsUnits[idx];
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'settings-list-edit-input';
    input.value = oldVal;
    span.replaceWith(input);
    input.focus();
    input.select();
    let saved = false;
    async function save() {
        if (saved) return;
        saved = true;
        const newVal = input.value.trim();
        if (!newVal || newVal === oldVal) {
            renderUnitSettingsItems();
            return;
        }
        if (settingsUnits.some((u, i) => i !== idx && u.toLowerCase() === newVal.toLowerCase())) {
            showNotificationModal(t('settings_unit_exists'));
            renderUnitSettingsItems();
            return;
        }
        settingsUnits[idx] = newVal;
        sortAlpha(settingsUnits);
        renderUnitSettingsItems();
        await saveMaterialSettings();
    }
    input.addEventListener('blur', save);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { saved = true; renderUnitSettingsItems(); }
    });
}

// ============================================
// DROPDOWN FOR MATERIALE OG ENHET
// ============================================

// Cache for dropdown options
let cachedMaterialOptions = null;
let cachedUnitOptions = null;

async function getDropdownOptions() {
    const data = await getMaterialSettings();
    cachedMaterialOptions = (data && data.materials) ? data.materials : [];
    cachedUnitOptions = (data && data.units) ? data.units : [];
    cachedMaterialOptions.sort((a, b) => a.name.localeCompare(b.name, 'no'));
    sortAlpha(cachedUnitOptions);
}


// ============================================
// STANDARDVERDIER (AUTOFYLL)
// ============================================

const DEFAULT_FIELDS = ['montor', 'avdeling', 'oppdragsgiver', 'kundens-ref', 'fakturaadresse', 'prosjektnr', 'prosjektnavn', 'sted'];

async function getDefaultSettings() {
    if (currentUser && db) {
        try {
            const doc = await db.collection('users').doc(currentUser.uid).collection('settings').doc('defaults').get();
            if (doc.exists) return doc.data();
        } catch (e) {
            console.error('Defaults error:', e);
        }
    }
    const stored = localStorage.getItem(DEFAULTS_KEY);
    return stored ? JSON.parse(stored) : {};
}

async function saveDefaultSettings() {
    const defaults = {};
    DEFAULT_FIELDS.forEach(field => {
        const val = document.getElementById('default-' + field).value.trim();
        if (val) defaults[field] = val;
    });

    if (currentUser && db) {
        try {
            await db.collection('users').doc(currentUser.uid).collection('settings').doc('defaults').set(defaults);
        } catch (e) {
            console.error('Save defaults error:', e);
        }
    }
    localStorage.setItem(DEFAULTS_KEY, JSON.stringify(defaults));
    showNotificationModal(t('settings_defaults_saved'), true);
}

async function loadDefaultSettingsToModal() {
    const defaults = await getDefaultSettings();
    DEFAULT_FIELDS.forEach(field => {
        document.getElementById('default-' + field).value = defaults[field] || '';
    });
}

async function autoFillDefaults() {
    const defaults = await getDefaultSettings();
    DEFAULT_FIELDS.forEach(field => {
        if (defaults[field]) {
            const el = document.getElementById(field);
            const mobileEl = document.getElementById('mobile-' + field);
            if (el) el.value = defaults[field];
            if (mobileEl) mobileEl.value = defaults[field];
        }
    });
}

function renderSettingsRanges() {
    const container = document.getElementById('settings-ranges');
    const countEl = document.getElementById('settings-count-ranges');
    if (settingsRanges.length === 0) {
        container.innerHTML = '<div style="font-size:13px;color:#999;margin-bottom:8px;">' + t('settings_no_ranges') + '</div>';
        if (countEl) countEl.textContent = '';
        return;
    }
    container.innerHTML = settingsRanges.map((r, idx) =>
        `<div class="settings-range-item">
            <span>${r.start} – ${r.end}</span>
            <button onclick="removeSettingsRange(${idx})" title="${t('btn_remove')}"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>
        </div>`
    ).join('');
    if (countEl) {
        let total = 0;
        settingsRanges.forEach(r => { total += r.end - r.start + 1; });
        countEl.textContent = '(' + settingsRanges.length + (settingsRanges.length === 1 ? ' serie, ' : ' serier, ') + total + ' nr)';
    }
}

async function addSettingsRange() {
    const startInput = document.getElementById('settings-new-start');
    const endInput = document.getElementById('settings-new-end');
    const start = parseInt(startInput.value);
    const end = parseInt(endInput.value);

    if (isNaN(start) || isNaN(end) || start > end) {
        showNotificationModal(t('settings_range_error'));
        return;
    }
    const overlaps = settingsRanges.some(r => start <= r.end && end >= r.start);
    if (overlaps) {
        showNotificationModal(t('settings_range_overlap'));
        return;
    }
    settingsRanges.push({ start, end });
    startInput.value = '';
    endInput.value = '';
    renderSettingsRanges();
    updateSettingsStatus();
    // Auto-save
    const settings = buildOrderNrSettings();
    if (currentUser && db) {
        try { await db.collection('users').doc(currentUser.uid).collection('settings').doc('ordrenr').set(settings); } catch (e) {}
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    showNotificationModal(t('settings_range_added'), true);
}

function removeSettingsRange(idx) {
    const r = settingsRanges[idx];
    showConfirmModal(t('settings_range_remove', r.start, r.end), async function() {
        settingsRanges.splice(idx, 1);
        renderSettingsRanges();
        updateSettingsStatus();
        // Auto-save
        const settings = buildOrderNrSettings();
        if (currentUser && db) {
            try { await db.collection('users').doc(currentUser.uid).collection('settings').doc('ordrenr').set(settings); } catch (e) {}
        }
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    });
}

function renderGivenAwayRanges() {
    const container = document.getElementById('settings-given-away');
    const countEl = document.getElementById('settings-count-giveaway');
    if (!container) return;
    if (settingsGivenAway.length === 0) {
        container.innerHTML = '';
        if (countEl) countEl.textContent = '';
        return;
    }
    container.innerHTML = settingsGivenAway.map((r, idx) =>
        `<div class="settings-range-item settings-given-item">
            <span>${r.start === r.end ? r.start : r.start + ' – ' + r.end}</span>
            <button onclick="removeGivenAway(${idx})" title="${t('btn_remove')}"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>
        </div>`
    ).join('');
    if (countEl) {
        let total = 0;
        settingsGivenAway.forEach(r => { total += r.end - r.start + 1; });
        countEl.textContent = '(' + total + ' nr)';
    }
}

async function addGivenAwayRange() {
    const startInput = document.getElementById('settings-give-start');
    const endInput = document.getElementById('settings-give-end');
    const start = parseInt(startInput.value);
    const end = endInput.value.trim() === '' ? start : parseInt(endInput.value);

    if (isNaN(start) || isNaN(end) || start > end) {
        showNotificationModal(t('settings_range_error'));
        return;
    }
    // Must be within an existing range
    if (!isNumberInRanges(start, settingsRanges) || !isNumberInRanges(end, settingsRanges)) {
        showNotificationModal(t('settings_give_not_in_range'));
        return;
    }
    // Check overlap with already given-away
    const overlapsGiven = settingsGivenAway.some(r => start <= r.end && end >= r.start);
    if (overlapsGiven) {
        showNotificationModal(t('settings_give_overlap'));
        return;
    }
    // Check if any numbers are already used (saved/sent)
    const usedNumbers = await getUsedOrderNumbers();
    for (let n = start; n <= end; n++) {
        if (usedNumbers.has(String(n))) {
            showNotificationModal(t('settings_give_already_used', n));
            return;
        }
    }
    settingsGivenAway.push({ start, end });
    settingsGivenAway.sort((a, b) => a.start - b.start);
    startInput.value = '';
    endInput.value = '';
    renderGivenAwayRanges();
    updateSettingsStatus();
    // Auto-save
    const settings = buildOrderNrSettings();
    if (currentUser && db) {
        try { await db.collection('users').doc(currentUser.uid).collection('settings').doc('ordrenr').set(settings); } catch (e) {}
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    showNotificationModal(t('settings_give_added'), true);
}

function removeGivenAway(idx) {
    const r = settingsGivenAway[idx];
    const label = r.start === r.end ? String(r.start) : r.start + ' – ' + r.end;
    showConfirmModal(t('settings_give_remove', label), async function() {
        settingsGivenAway.splice(idx, 1);
        renderGivenAwayRanges();
        updateSettingsStatus();
        // Auto-save
        const settings = buildOrderNrSettings();
        if (currentUser && db) {
            try { await db.collection('users').doc(currentUser.uid).collection('settings').doc('ordrenr').set(settings); } catch (e) {}
        }
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    });
}

function getGivenAwayNumbers() {
    const given = new Set();
    settingsGivenAway.forEach(r => {
        for (let n = r.start; n <= r.end; n++) given.add(String(n));
    });
    return given;
}

async function updateSettingsStatus() {
    const statusEl = document.getElementById('settings-status');
    if (settingsRanges.length === 0) {
        statusEl.textContent = '';
        return;
    }

    let total = 0;
    settingsRanges.forEach(r => { total += r.end - r.start + 1; });

    const usedNumbers = await getUsedOrderNumbers();
    const givenNumbers = getGivenAwayNumbers();
    let usedCount = 0;
    let givenCount = 0;
    settingsRanges.forEach(r => {
        for (let n = r.start; n <= r.end; n++) {
            if (givenNumbers.has(String(n))) givenCount++;
            else if (usedNumbers.has(String(n))) usedCount++;
        }
    });

    // Merge given into used for "next" calculation
    const allUnavailable = new Set([...usedNumbers, ...givenNumbers]);
    const nextNr = findNextInRanges(settingsRanges, allUnavailable);
    let statusText = t('settings_used', usedCount, total);
    if (givenCount > 0) statusText += ' · ' + t('settings_given_away_count', givenCount);
    statusText += nextNr ? ' · ' + t('settings_next', nextNr) : ' · ' + t('settings_all_used');
    statusEl.textContent = statusText;
}

async function getUsedOrderNumbers() {
    const saved = await getSavedForms();
    const archived = await getSentForms();
    const used = new Set();
    saved.forEach(f => { if (f.ordreseddelNr) used.add(String(f.ordreseddelNr)); });
    archived.forEach(f => { if (f.ordreseddelNr) used.add(String(f.ordreseddelNr)); });
    return used;
}

function findNextInRanges(ranges, usedNumbers) {
    for (const r of ranges) {
        for (let n = r.start; n <= r.end; n++) {
            if (!usedNumbers.has(String(n))) return n;
        }
    }
    return null;
}

async function getNextOrderNumber() {
    const settings = await getOrderNrSettings();
    if (!settings || !settings.ranges || settings.ranges.length === 0) return null;
    const usedNumbers = await getUsedOrderNumbers();
    // Also exclude given-away numbers
    const givenAway = settings.givenAway || [];
    givenAway.forEach(r => {
        for (let n = r.start; n <= r.end; n++) usedNumbers.add(String(n));
    });
    return findNextInRanges(settings.ranges, usedNumbers);
}

function isNumberInRanges(nr, ranges) {
    const n = parseInt(nr, 10);
    if (isNaN(n)) return false;
    for (const r of ranges) {
        if (n >= r.start && n <= r.end) return true;
    }
    return false;
}

function updateExternalBadge() {
    const badge = document.getElementById('external-badge');
    if (badge) badge.style.display = isExternalForm ? '' : 'none';
}

function startExternalOrder() {
    document.getElementById('template-modal').classList.remove('active');
    document.body.classList.remove('modal-active', 'template-modal-open');
    updateToolbarState();
    document.getElementById('template-search').value = '';
    if (preNewFormData) {
        clearForm();
        preNewFormData = null;
        setFormReadOnly(false);
    }
    isExternalForm = true;
    updateExternalBadge();
    // External form = #ekstern
    window.location.hash = 'ekstern';
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    // Update form header title
    document.getElementById('form-header-title').textContent = t('external_form_title');
}

function hasAnyFormData() {
    // Hent standardverdier for sammenligning
    const defaults = JSON.parse(localStorage.getItem('firesafe_defaults') || '{}');

    // Felt som MÅ ha bruker-input (ikke standardverdier)
    const requiredFields = [
        { id: 'mobile-ordreseddel-nr', default: '' },
        { id: 'mobile-oppdragsgiver', default: defaults.oppdragsgiver || '' },
        { id: 'mobile-prosjektnr', default: defaults.prosjektnr || '' },
        { id: 'mobile-prosjektnavn', default: defaults.prosjektnavn || '' }
    ];

    for (const field of requiredFields) {
        const value = document.getElementById(field.id).value.trim();
        if (value && value !== field.default) return true;
    }

    // Sjekk orders - har de beskrivelse?
    const orderCards = document.querySelectorAll('#mobile-orders .mobile-order-card');
    for (const card of orderCards) {
        const descInput = card.querySelector('.mobile-order-desc');
        const descVal = descInput.getAttribute('data-full-value') || descInput.value;
        if (descVal.trim()) return true;
    }

    // Sjekk om det er en signatur
    const signature = document.getElementById('mobile-kundens-underskrift').value;
    if (signature) return true;

    return false;
}

function clearForm() {
    document.querySelectorAll('#form-container input, #form-container textarea').forEach(el => el.value = '');
    document.querySelectorAll('#mobile-form input, #mobile-form textarea').forEach(el => {
        el.value = '';
        el.removeAttribute('data-full-value');
    });

    // Clear signature
    document.getElementById('kundens-underskrift').value = '';
    document.getElementById('mobile-kundens-underskrift').value = '';
    clearSignaturePreview();

    const now = new Date();
    const today = formatDate(now);
    document.getElementById('signering-dato').value = today;
    document.getElementById('mobile-signering-dato').value = today;

    const week = 'Uke ' + getWeekNumber(now);
    document.getElementById('dato').value = week;
    document.getElementById('mobile-dato').value = week;

    sessionStorage.removeItem('firesafe_current');
    sessionStorage.removeItem('firesafe_current_sent');
    lastSavedData = null;
    isExternalForm = false;
    updateExternalBadge();

    // Reset orders to 1 empty card
    const container = document.getElementById('mobile-orders');
    container.innerHTML = '';
    container.appendChild(createOrderCard({ description: '', materials: [], timer: '' }, true));
    updateOrderDeleteStates();

    // Clear desktop work lines
    document.getElementById('work-lines').innerHTML = '';

    window.scrollTo(0, 0);
}

function doNewForm() {
    closeAllModals();
    preNewFormData = getFormData();
    showTemplateModal();
}

function newForm() {
    // Sjekk om vi er på skjema-siden (ikke modal)
    const isOnFormPage = !document.getElementById('saved-modal').classList.contains('active')
        && !document.getElementById('settings-modal').classList.contains('active')
        && !document.getElementById('template-modal').classList.contains('active');

    if (!isOnFormPage) {
        // Fra modal - gå direkte til prosjektmal
        doNewForm();
        return;
    }

    const currentData = getFormDataSnapshot();
    const hasUnsavedChanges = lastSavedData !== null
        ? currentData !== lastSavedData
        : hasAnyFormData();

    if (hasUnsavedChanges) {
        showConfirmModal(t('new_form_confirm'), doNewForm, t('btn_start_new'), '#E8501A');
    } else {
        doNewForm();
    }
}

function duplicateCurrentForm() {
    // Clear order number and signature fields
    document.getElementById('ordreseddel-nr').value = '';
    document.getElementById('mobile-ordreseddel-nr').value = '';
    document.getElementById('kundens-underskrift').value = '';
    document.getElementById('mobile-kundens-underskrift').value = '';
    clearSignaturePreview();

    // Sett uke til nåværende
    var now = new Date();
    var week = 'Uke ' + getWeekNumber(now);
    document.getElementById('dato').value = week;
    document.getElementById('mobile-dato').value = week;

    // Sett signeringsdato til i dag
    var today = formatDate(now);
    document.getElementById('signering-dato').value = today;
    document.getElementById('mobile-signering-dato').value = today;

    // Reset bestillinger til 1 tomt ordrekort
    var container = document.getElementById('mobile-orders');
    container.innerHTML = '';
    container.appendChild(createOrderCard({ description: '', materials: [], timer: '' }, true));
    updateOrderDeleteStates();
    document.getElementById('work-lines').innerHTML = '';

    // Mark as unsaved
    lastSavedData = null;

    // Remove sent banner if visible
    document.getElementById('sent-banner').style.display = 'none';
    setFormReadOnly(false);

    // Auto-fill next order number
    autoFillOrderNumber();
    window.scrollTo(0, 0);
}

// Felles canvas-rendering for eksport/deling
async function renderFormToCanvas() {
    if (isMobile()) {
        syncMobileToOriginal();
    }

    const element = document.getElementById('form-container');
    const originalDisplay = element.style.display;
    const originalPosition = element.style.position;
    const originalLeft = element.style.left;
    const originalWidth = element.style.width;

    element.style.display = 'block';
    element.style.width = '800px';
    element.style.visibility = 'hidden';
    element.style.position = 'fixed';
    element.style.top = '0';
    element.style.left = '0';

    await new Promise(resolve => requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
    }));

    const convertedElements = convertTextareasToDiv();

    // Midlertidig fjern disabled for ren eksport
    const disabledFields = element.querySelectorAll('input:disabled, textarea:disabled, select:disabled');
    disabledFields.forEach(el => el.disabled = false);

    await new Promise(resolve => requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
    }));

    element.style.visibility = 'visible';
    element.style.position = 'absolute';
    element.style.left = '-9999px';
    element.style.top = '';

    const canvas = await html2canvas(element, {
        scale: 3,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
    });

    // Gjenopprett disabled-tilstand
    disabledFields.forEach(el => el.disabled = true);
    restoreTextareas(convertedElements);

    element.style.display = originalDisplay;
    element.style.position = originalPosition;
    element.style.left = originalLeft;
    element.style.width = originalWidth;
    element.style.visibility = '';
    element.style.top = '';

    if (isMobile()) {
        element.style.display = 'none';
    }

    return canvas;
}

function getExportFilename(ext) {
    const ordrenr = document.getElementById('ordreseddel-nr').value || document.getElementById('mobile-ordreseddel-nr').value || 'ukjent';
    const dato = document.getElementById('dato').value.replace(/\./g, '-') || formatDate(new Date()).replace(/\./g, '-');
    return `ordreseddel_${ordrenr}_${dato}.${ext}`;
}

async function doExportPDF() {
    if (!validateRequiredFields()) return;
    const loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        const canvas = await renderFormToCanvas();
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const imgWidth = 210;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, imgWidth, imgHeight);
        pdf.save(getExportFilename('pdf'));
    } catch (error) {
        alert(t('export_pdf_error') + error.message);
    } finally {
        loading.classList.remove('active');
    }
}

async function doExportPNG() {
    if (!validateRequiredFields()) return;
    const loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        const canvas = await renderFormToCanvas();
        const link = document.createElement('a');
        link.download = getExportFilename('png');
        link.href = canvas.toDataURL('image/png');
        link.click();
    } catch (error) {
        alert(t('export_png_error') + error.message);
    } finally {
        loading.classList.remove('active');
    }
}

async function markAsSentAndExport(type) {
    if (!validateRequiredFields()) return;
    await markAsSent();
    if (type === 'pdf') {
        await doExportPDF();
    } else {
        await doExportPNG();
    }
    setFormReadOnly(true);
}


document.getElementById('saved-modal').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
});


document.getElementById('template-modal').addEventListener('click', function(e) {
    if (e.target === this) cancelTemplateModal();
});

// Sync forms when typing (with debounced sessionStorage save)
var sessionSaveTimeout = null;
function debouncedSessionSave() {
    clearTimeout(sessionSaveTimeout);
    sessionSaveTimeout = setTimeout(function() {
        sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    }, 500);
}

document.getElementById('mobile-form').addEventListener('input', function() {
    syncMobileToOriginal();
    debouncedSessionSave();
});

document.getElementById('form-container').addEventListener('input', function() {
    syncOriginalToMobile();
    debouncedSessionSave();
});

window.addEventListener('load', function() {
    // PWA pull-to-refresh workaround: Force layout recalculation
    setTimeout(function() {
        void document.body.offsetHeight;
    }, 50);

    const current = sessionStorage.getItem('firesafe_current');
    if (current) {
        try {
            const data = JSON.parse(current);
            setFormData(data);
        } catch (e) {}
    }
    // Alltid sett signering-dato til dagens dato og tøm kundens underskrift ved oppstart
    const today = formatDate(new Date());
    document.getElementById('signering-dato').value = today;
    document.getElementById('kundens-underskrift').value = '';
    document.getElementById('mobile-signering-dato').value = today;
    document.getElementById('mobile-kundens-underskrift').value = '';

    // Initialize orders if empty (first load without session data)
    const ordersContainer = document.getElementById('mobile-orders');
    if (ordersContainer && ordersContainer.children.length === 0) {
        ordersContainer.appendChild(createOrderCard({ description: '', materials: [], timer: '' }, true));
        updateOrderDeleteStates();
    }

    // Apply saved language
    applyTranslations();

    // Load dropdown options for materials/units
    getDropdownOptions();

    // Hash routing: restore view state on refresh
    const hash = window.location.hash.slice(1);
    if (hash === 'hent') {
        showSavedForms();
    } else if (hash === 'settings') {
        showSettingsModal();
    } else if (hash === 'skjema' || hash === 'ekstern') {
        // Form - already loaded via sessionStorage
        closeAllModals();
        document.getElementById('form-header-title').textContent = t(hash === 'ekstern' ? 'external_form_title' : 'form_title');
        // Restore sent status
        const wasSent = sessionStorage.getItem('firesafe_current_sent') === '1';
        if (wasSent) {
            setFormReadOnly(true);
        }
        updateToolbarState();
    } else {
        // No hash = home = template modal
        showTemplateModal();
    }
});

// Handle browser back/forward buttons
window.addEventListener('hashchange', function() {
    const hash = window.location.hash.slice(1);
    closeAllModals();
    if (hash === 'hent') {
        showSavedForms();
    } else if (hash === 'settings') {
        showSettingsModal();
    } else if (hash === 'skjema') {
        document.getElementById('form-header-title').textContent = t('form_title');
    } else if (hash === 'ekstern') {
        document.getElementById('form-header-title').textContent = t('external_form_title');
    } else {
        // No hash = home = template modal
        showTemplateModal();
    }
});

// Keyboard detection using visualViewport
(function() {
    if (!window.visualViewport) return;

    let initialHeight = window.innerHeight;

    window.visualViewport.addEventListener('resize', function() {
        const heightDiff = initialHeight - window.visualViewport.height;
        if (heightDiff > 150) {
            document.body.classList.add('keyboard-open');
        } else {
            document.body.classList.remove('keyboard-open');
        }
    });
})();

