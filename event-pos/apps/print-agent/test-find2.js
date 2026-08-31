const usb = require('usb');
const vid = 8137;
const pid = 8214;
console.log(usb.getDeviceList().find(d => d.deviceDescriptor.idVendor === vid && d.deviceDescriptor.idProduct === pid));
