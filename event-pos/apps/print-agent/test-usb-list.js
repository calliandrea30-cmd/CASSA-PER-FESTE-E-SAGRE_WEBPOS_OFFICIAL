const usb = require('usb');
const list = usb.getDeviceList();
console.log("Devices:");
list.forEach(d => {
  console.log(`VID: 0x${d.deviceDescriptor.idVendor.toString(16)} PID: 0x${d.deviceDescriptor.idProduct.toString(16)}`);
});
