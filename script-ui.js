// Cache for loaded forms (to use with index-based functions)
let loadedForms = [];
let loadedExternalForms = [];

function closeAllModals() {
    document.querySelectorAll('.modal.active').forEach(function(m) { m.classList.remove('active'); });
}

async function showSavedForms() {
    closeAllModals();
    const listEl = document.getElementById('saved-list');
    listEl.innerHTML = '<div class="no-saved">' + t('loading') + '</div>';
    document.getElementById('saved-modal').classList.add('active');

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
            const dato = item.signeringDato || '';
            const isSent = item._isSent;

            const dot = `<span class="status-dot ${isSent ? 'sent' : 'saved'}"></span>`;

            return `
                <div class="saved-item" onclick="loadForm(${index})">
                    <div class="saved-item-info">
                        <div class="saved-item-row1">${dot}${ordrenr || t('no_name')}</div>
                        ${dato ? `<div class="saved-item-date">${dato}</div>` : ''}
                    </div>
                    <div class="saved-item-buttons">
                        <button class="saved-item-icon-btn more" onclick="showItemMenu(event, 'form', ${index}, ${isSent})">\u22EE</button>
                    </div>
                </div>
            `;
        }).join('');
    }
}

function setFormReadOnly(readOnly) {
    const fields = document.querySelectorAll('#mobile-form input, #mobile-form textarea, #mobile-form select, #form-container input, #form-container textarea, #form-container select');
    fields.forEach(el => el.disabled = readOnly);
    document.querySelector('.btn-save').disabled = readOnly;
    document.getElementById('sent-banner').style.display = readOnly ? 'block' : 'none';
}

function loadForm(index) {
    if (loadedForms[index]) {
        setFormData(loadedForms[index]);
        lastSavedData = getFormDataSnapshot();
        setFormReadOnly(!!loadedForms[index]._isSent);
        closeModal();
    }
}

async function duplicateForm(event, index) {
    event.stopPropagation();
    const form = loadedForms[index];
    if (!form) return;

    setFormData(form);
    // Tøm ordrenummer og sett nytt
    document.getElementById('ordreseddel-nr').value = '';
    document.getElementById('mobile-ordreseddel-nr').value = '';
    isExternalForm = false;
    updateExternalBadge();
    await autoFillOrderNumber();
    lastSavedData = null;
    setFormReadOnly(false);
    closeModal();
    showNotificationModal(t('duplicated_success'), true);
}

function deleteForm(event, index) {
    event.stopPropagation();
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
    document.getElementById('saved-search').value = '';
    document.getElementById('external-search').value = '';
    // Reset to own tab
    switchHentTab('own');
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
    } else if (tab === 'external') {
        tabs[1].classList.add('active');
        externalList.style.display = '';
        externalSearch.style.display = '';
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
    showActionPopup(t('save_menu_title'), [
        { label: t('save_option'), onclick: 'saveForm()' },
        { label: t('save_as_template'), onclick: 'saveAsTemplate()' }
    ]);
}

// Keep old names for compatibility
function closeSaveMenu() { closeActionPopup(); }
function closeExportMenu() { closeActionPopup(); }
function showExportMenu() {
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
            '<button class="confirm-btn-ok" style="background:#2c3e50" onclick="doExportJPG(); closeActionPopup()">JPG</button>' +
        '</div>';
    if (!isSent) {
        html += '<div style="font-size:12px;color:#888;margin:10px 0 4px;">' + t('export_and_mark_label') + '</div>' +
            '<div class="confirm-modal-buttons">' +
                '<button class="confirm-btn-ok" style="background:#E8501A" onclick="markAsSentAndExport(\'pdf\'); closeActionPopup()">PDF</button>' +
                '<button class="confirm-btn-ok" style="background:#E8501A" onclick="markAsSentAndExport(\'jpg\'); closeActionPopup()">JPG</button>' +
            '</div>';
    }
    html += '<div class="confirm-modal-buttons" style="margin-top:10px"><button class="confirm-btn-cancel" style="flex:1" onclick="closeActionPopup()">' + t('btn_cancel') + '</button></div>';
    buttonsEl.innerHTML = html;
    popup.classList.add('active');
}

function filterOwnForms() {
    const searchTerm = document.getElementById('saved-search').value.toLowerCase();
    const items = document.querySelectorAll('#saved-list .saved-item');
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(searchTerm) ? 'flex' : 'none';
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
    event.stopPropagation();
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
            const dato = item.signeringDato || '';
            const isSent = item._isSent;

            const dot = `<span class="status-dot ${isSent ? 'sent' : 'saved'}"></span>`;

            return `
                <div class="saved-item" onclick="loadExternalForm(${index})">
                    <div class="saved-item-info">
                        <div class="saved-item-row1">${dot}${ordrenr || t('no_name')}</div>
                        ${dato ? `<div class="saved-item-date">${dato}</div>` : ''}
                    </div>
                    <div class="saved-item-buttons">
                        <button class="saved-item-icon-btn more" onclick="showItemMenu(event, 'external', ${index}, false)">\u22EE</button>
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
    setFormReadOnly(!!form._isSent);
    closeModal();
}

function deleteExternalForm(event, index) {
    event.stopPropagation();
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
    const searchTerm = document.getElementById('external-search').value.toLowerCase();
    const items = document.querySelectorAll('#external-list .saved-item');
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(searchTerm) ? 'flex' : 'none';
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
            const existing = await templatesRef.where('prosjektnavn', '==', templateData.prosjektnavn).get();

            if (!existing.empty) {
                showConfirmModal(t('template_exists', templateData.prosjektnavn), async function() {
                    await templatesRef.doc(existing.docs[0].id).set(templateData);
                    showNotificationModal(t('template_update_success'), true);
                }, t('btn_update'), '#E8501A');
            } else {
                const docId = Date.now().toString();
                await templatesRef.doc(docId).set(templateData);
                showNotificationModal(t('template_save_success'), true);
            }
        } catch (e) {
            console.error('Save template error:', e);
            showNotificationModal(t('template_save_error') + e.message);
        }
    } else {
        // localStorage fallback
        const templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]');
        const existingIndex = templates.findIndex(t => t.prosjektnavn.toLowerCase() === templateData.prosjektnavn.toLowerCase());

        if (existingIndex !== -1) {
            showConfirmModal(t('template_exists', templateData.prosjektnavn), function() {
                templateData.id = templates[existingIndex].id;
                templates[existingIndex] = templateData;
                localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
                showNotificationModal(t('template_update_success'), true);
            }, t('btn_update'), '#E8501A');
        } else {
            templateData.id = Date.now().toString();
            templates.push(templateData);
            localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
            showNotificationModal(t('template_save_success'), true);
        }
    }
}

async function showTemplateModal() {
    closeAllModals();
    const listEl = document.getElementById('template-list');
    listEl.innerHTML = '<div class="no-saved">' + t('loading') + '</div>';
    document.getElementById('template-modal').classList.add('active');

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
                        <button class="saved-item-icon-btn more" onclick="showItemMenu(event, 'template', ${index}, false)">\u22EE</button>
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
    document.getElementById('template-search').value = '';
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
    if (preNewFormData) {
        clearForm();
        preNewFormData = null;
        setFormReadOnly(false);
        autoFillOrderNumber();
        autoFillDefaults();
    }
    document.getElementById('template-modal').classList.remove('active');
    document.getElementById('template-search').value = '';
}

function cancelTemplateModal() {
    if (preNewFormData) {
        setFormData(preNewFormData);
        preNewFormData = null;
    }
    document.getElementById('template-modal').classList.remove('active');
    document.getElementById('template-search').value = '';
}

function filterTemplates() {
    const searchTerm = document.getElementById('template-search').value.toLowerCase();
    const items = document.querySelectorAll('#template-list .saved-item');
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(searchTerm) ? 'flex' : 'none';
    });
}

// ============================================
// ORDRESEDDELNUMMER INNSTILLINGER
// ============================================

// In-memory ranges for settings modal editing
let settingsRanges = [];

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
    return data;
}

async function saveOrderNrSettings() {
    if (settingsRanges.length === 0) {
        showNotificationModal(t('settings_add_range'));
        return;
    }
    const settings = { ranges: settingsRanges.slice() };

    if (currentUser && db) {
        try {
            await db.collection('users').doc(currentUser.uid).collection('settings').doc('ordrenr').set(settings);
        } catch (e) {
            console.error('Save settings error:', e);
        }
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    showNotificationModal(t('settings_saved'), true);
    closeSettingsModal();
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
    showSettingsMenu();
    document.getElementById('settings-modal').classList.add('active');
}

function closeSettingsModal() {
    document.getElementById('settings-modal').classList.remove('active');
    showSettingsMenu();
}

function showSettingsMenu() {
    document.querySelectorAll('.settings-page').forEach(p => p.style.display = 'none');
    document.getElementById('settings-page-menu').style.display = 'block';
    document.getElementById('settings-header-title').textContent = t('settings_title');
    const header = document.getElementById('settings-header');
    const existingBack = header.querySelector('.settings-back-btn');
    if (existingBack) existingBack.remove();
}

async function showSettingsPage(page) {
    document.querySelectorAll('.settings-page').forEach(p => p.style.display = 'none');
    document.getElementById('settings-page-' + page).style.display = 'block';
    document.getElementById('settings-header-title').textContent = getSettingsPageTitle(page);

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
        renderSettingsRanges();
        document.getElementById('settings-new-start').value = '';
        document.getElementById('settings-new-end').value = '';
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

async function getMaterialSettings() {
    if (currentUser && db) {
        try {
            const doc = await db.collection('settings').doc('materials').get();
            if (doc.exists) return doc.data();
        } catch (e) {
            console.error('Materials settings error:', e);
        }
    }
    const stored = localStorage.getItem(MATERIALS_KEY);
    return stored ? JSON.parse(stored) : { materials: [], units: [] };
}

async function saveMaterialSettings() {
    const data = { materials: settingsMaterials.slice(), units: settingsUnits.slice() };
    if (currentUser && db) {
        try {
            await db.collection('settings').doc('materials').set(data);
        } catch (e) {
            console.error('Save materials settings error:', e);
        }
    }
    localStorage.setItem(MATERIALS_KEY, JSON.stringify(data));
    // Refresh dropdown cache
    cachedMaterialOptions = settingsMaterials.slice();
    cachedUnitOptions = settingsUnits.slice();
}

async function loadMaterialSettingsToModal() {
    const data = await getMaterialSettings();
    settingsMaterials = (data && data.materials) ? data.materials.slice() : [];
    settingsUnits = (data && data.units) ? data.units.slice() : [];
    sortAlpha(settingsMaterials);
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
        `<div class="settings-list-item"><span>${item}</span><button onclick="removeSettingsMaterial(${idx})" title="${t('btn_remove')}">&times;</button></div>`
    ).join('');
}

function renderUnitSettingsItems() {
    const container = document.getElementById('settings-unit-items');
    if (settingsUnits.length === 0) {
        container.innerHTML = '<div style="font-size:13px;color:#999;margin-bottom:8px;">' + t('settings_no_units') + '</div>';
        return;
    }
    container.innerHTML = settingsUnits.map((item, idx) =>
        `<div class="settings-list-item"><span>${item}</span><button onclick="removeSettingsUnit(${idx})" title="${t('btn_remove')}">&times;</button></div>`
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
    if (settingsMaterials.some(m => m.toLowerCase() === val.toLowerCase())) {
        showNotificationModal(t('settings_material_exists'));
        return;
    }
    settingsMaterials.push(val);
    sortAlpha(settingsMaterials);
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
    showConfirmModal(t('settings_material_remove', item), async function() {
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
    sortAlpha(cachedMaterialOptions);
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
    if (settingsRanges.length === 0) {
        container.innerHTML = '<div style="font-size:13px;color:#999;margin-bottom:8px;">' + t('settings_no_ranges') + '</div>';
        return;
    }
    container.innerHTML = settingsRanges.map((r, idx) =>
        `<div class="settings-range-item">
            <span>${r.start} – ${r.end}</span>
            <button onclick="removeSettingsRange(${idx})" title="${t('btn_remove')}"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>
        </div>`
    ).join('');
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
    const settings = { ranges: settingsRanges.slice() };
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
        const settings = { ranges: settingsRanges.slice() };
        if (currentUser && db) {
            try { await db.collection('users').doc(currentUser.uid).collection('settings').doc('ordrenr').set(settings); } catch (e) {}
        }
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    });
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
    let usedCount = 0;
    settingsRanges.forEach(r => {
        for (let n = r.start; n <= r.end; n++) {
            if (usedNumbers.has(String(n))) usedCount++;
        }
    });

    const nextNr = findNextInRanges(settingsRanges, usedNumbers);
    statusEl.textContent = t('settings_used', usedCount, total) + (nextNr ? ' · ' + t('settings_next', nextNr) : ' · ' + t('settings_all_used'));
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
    document.getElementById('template-search').value = '';
    if (preNewFormData) {
        clearForm();
        preNewFormData = null;
        setFormReadOnly(false);
    }
    isExternalForm = true;
    updateExternalBadge();
}

function hasAnyFormData() {
    const fields = ['mobile-ordreseddel-nr', 'mobile-oppdragsgiver', 'mobile-prosjektnr', 'mobile-prosjektnavn', 'mobile-montor', 'mobile-avdeling', 'mobile-dato'];
    for (const id of fields) {
        if (document.getElementById(id).value.trim()) return true;
    }
    const orderCards = document.querySelectorAll('#mobile-orders .mobile-order-card');
    for (const card of orderCards) {
        const descInput = card.querySelector('.mobile-order-desc');
        const descVal = descInput.getAttribute('data-full-value') || descInput.value;
        if (descVal.trim()) return true;
    }
    return false;
}

function clearForm() {
    document.querySelectorAll('#form-container input, #form-container textarea').forEach(el => el.value = '');
    document.querySelectorAll('#mobile-form input, #mobile-form textarea').forEach(el => {
        el.value = '';
        el.removeAttribute('data-full-value');
    });

    const today = formatDate(new Date());
    document.getElementById('signering-dato').value = today;
    document.getElementById('mobile-signering-dato').value = today;

    sessionStorage.removeItem('firesafe_current');
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
}

function doNewForm() {
    preNewFormData = getFormData();
    showTemplateModal();
}

function newForm() {
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

function showPostSavePrompt() {
    showActionPopup(t('save_success'), [
        { label: t('toolbar_new'), onclick: 'newForm()' },
        { label: t('duplicate_btn'), onclick: 'duplicateCurrentForm()' }
    ]);
}

function duplicateCurrentForm() {
    // Clear order number and signature fields
    document.getElementById('ordreseddel-nr').value = '';
    document.getElementById('mobile-ordreseddel-nr').value = '';
    document.getElementById('signering-dato').value = '';
    document.getElementById('mobile-signering-dato').value = '';
    document.getElementById('kundens-underskrift').value = '';
    document.getElementById('mobile-kundens-underskrift').value = '';

    // Mark as unsaved
    lastSavedData = null;

    // Remove sent banner if visible
    document.getElementById('sent-banner').style.display = 'none';
    setFormReadOnly(false);

    // Auto-fill next order number
    autoFillOrderNumber();
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

    await new Promise(resolve => requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
    }));

    element.style.visibility = 'visible';
    element.style.position = 'absolute';
    element.style.left = '-9999px';
    element.style.top = '';

    const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
    });

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
    const prosjektnr = document.getElementById('prosjektnr').value || 'ukjent';
    const dato = document.getElementById('dato').value.replace(/\./g, '-') || formatDate(new Date()).replace(/\./g, '-');
    return `ordreseddel_${prosjektnr}_${dato}.${ext}`;
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
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, imgWidth, imgHeight);
        pdf.save(getExportFilename('pdf'));
    } catch (error) {
        alert(t('export_pdf_error') + error.message);
    } finally {
        loading.classList.remove('active');
    }
}

async function doExportJPG() {
    if (!validateRequiredFields()) return;
    const loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        const canvas = await renderFormToCanvas();
        const link = document.createElement('a');
        link.download = getExportFilename('jpg');
        link.href = canvas.toDataURL('image/jpeg', 0.95);
        link.click();
    } catch (error) {
        alert(t('export_jpg_error') + error.message);
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
        await doExportJPG();
    }
    setFormReadOnly(true);
}


document.getElementById('saved-modal').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
});


document.getElementById('template-modal').addEventListener('click', function(e) {
    if (e.target === this) cancelTemplateModal();
});

// Sync forms when typing
document.getElementById('mobile-form').addEventListener('input', function() {
    syncMobileToOriginal();
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
});

document.getElementById('form-container').addEventListener('input', function() {
    syncOriginalToMobile();
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
});

window.addEventListener('load', function() {
    const current = sessionStorage.getItem('firesafe_current');
    if (current) {
        try {
            const data = JSON.parse(current);
            if (data.oppdragsgiver || data.prosjektnavn || data.prosjektnr || (data.orders && data.orders.length > 0)) {
                setFormData(data);
            }
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
});

/// Keyboard-aware toolbar: sticky when no keyboard, static when keyboard open
(function() {
    var toolbar = document.querySelector('.toolbar');
    if (!toolbar) return;

    if (window.visualViewport) {
        var initialHeight = window.innerHeight;
        visualViewport.addEventListener('resize', function() {
            if (visualViewport.height < initialHeight * 0.75) {
                toolbar.classList.add('keyboard-open');
            } else {
                toolbar.classList.remove('keyboard-open');
                initialHeight = visualViewport.height;
            }
        });
    }
})();
