'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ── Espone solo le funzioni necessarie al renderer ────────────────────────────
contextBridge.exposeInMainWorld('sagrapos', {
  // Config
  getConfig:    ()       => ipcRenderer.invoke('get-config'),
  saveConfig:   (data)   => ipcRenderer.invoke('save-config', data),
  resetConfig:  ()       => ipcRenderer.invoke('reset-config'),
  getNodeInfo:  ()       => ipcRenderer.invoke('get-node-info'),

  // Stato
  getStatus: () => ipcRenderer.invoke('get-status'),
  getLogs:   () => ipcRenderer.invoke('get-logs'),

  // Controllo servizi
  startAll: () => ipcRenderer.invoke('start-all'),
  stopAll:  () => ipcRenderer.invoke('stop-all'),

  // Navigazione
  openBrowser: () => ipcRenderer.invoke('open-browser'),
  openAdmin:   () => ipcRenderer.invoke('open-admin'),
  openSetup:   () => ipcRenderer.invoke('open-setup-window'),

  // Setup wizard
  completeSetup: (data) => ipcRenderer.invoke('complete-setup', data),
  testServer:    (url)  => ipcRenderer.invoke('test-server', url),

  // Listener eventi dal main
  onLog:     (cb) => { ipcRenderer.on('log',     (_, v) => cb(v)); },
  onStatus:  (cb) => { ipcRenderer.on('status',  (_, v) => cb(v)); },
  onStarting:(cb) => { ipcRenderer.on('starting', (_, v) => cb(v)); },
});
