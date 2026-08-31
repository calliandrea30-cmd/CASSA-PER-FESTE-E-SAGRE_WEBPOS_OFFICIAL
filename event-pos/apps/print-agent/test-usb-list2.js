const usb = require('usb');
const list = usb.getDeviceList();
console.log("Devices:", list.map(d => ({ vid: d.deviceDescriptor.idVendor, pid: d.deviceDescriptor.idProduct })));
