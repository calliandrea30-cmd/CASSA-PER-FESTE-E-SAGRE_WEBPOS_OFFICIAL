const usb = require('usb');
usb.on = function() {}; // MONKEY PATCH

const escpos = require('escpos');
escpos.USB = require('escpos-usb');

console.log("Trying to find USB printer 0x1fc9, 0x2016...");
try {
  const device = new escpos.USB(0x1fc9, 0x2016);
  console.log("Found it! Opening...");
  
  device.open((error) => {
    if (error) {
       console.error("Failed to open:", error);
    } else {
       console.log("SUCCESSFULLY OPENED!");
       
       const printer = new escpos.Printer(device);
       printer.text('Test di Stampa Diretto').cut().close();
    }
  });
} catch (e) {
  console.error("Error finding device:", e);
}
