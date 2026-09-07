using System;
using System.IO;
using System.Runtime.InteropServices;

public class RawPrint {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public class DOCINFOW {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPWStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern int StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);

    [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

    public static int Main(string[] args) {
        if (args.Length < 2) {
            Console.Error.WriteLine("Uso: RawPrint.exe <PrinterName> <FilePath>");
            return 1;
        }
        string szPrinterName = args[0];
        string szFileName = args[1];

        if (!File.Exists(szFileName)) {
            Console.Error.WriteLine("File non trovato: " + szFileName);
            return 2;
        }

        byte[] bytes;
        try {
            bytes = File.ReadAllBytes(szFileName);
        } catch (Exception ex) {
            Console.Error.WriteLine("Errore lettura file: " + ex.Message);
            return 2;
        }

        int nLength = bytes.Length;
        if (nLength == 0) return 0;

        IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(nLength);
        Marshal.Copy(bytes, 0, pUnmanagedBytes, nLength);

        IntPtr hPrinter = IntPtr.Zero;
        DOCINFOW di = new DOCINFOW();
        di.pDocName = "SagraPOS Scontrino";
        di.pDataType = "RAW";

        bool bSuccess = false;
        try {
            if (OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {
                if (StartDocPrinter(hPrinter, 1, di) > 0) {
                    if (StartPagePrinter(hPrinter)) {
                        int totalWritten = 0;
                        bSuccess = true;
                        while (totalWritten < nLength) {
                            int written = 0;
                            IntPtr pCurrent = new IntPtr(pUnmanagedBytes.ToInt64() + totalWritten);
                            if (!WritePrinter(hPrinter, pCurrent, nLength - totalWritten, out written) || written <= 0) {
                                bSuccess = false;
                                break;
                            }
                            totalWritten += written;
                        }
                        EndPagePrinter(hPrinter);
                    }
                    EndDocPrinter(hPrinter);
                }
                ClosePrinter(hPrinter);
            }
        } finally {
            Marshal.FreeCoTaskMem(pUnmanagedBytes);
        }

        if (bSuccess) {
            Console.WriteLine("OK");
            return 0;
        } else {
            Console.Error.WriteLine("Errore invio dati alla stampante Win32: " + szPrinterName);
            return 3;
        }
    }
}
