param (
    [string]$PrinterName = "",
    [string]$FilePath = ""
)

$ErrorActionPreference = "Stop"

if (-not $FilePath -or -not (Test-Path $FilePath)) {
    Write-Error "File non trovato: $FilePath"
    exit 1
}

# Se il nome della stampante non e fornito, cerca la predefinita o una stampante POS
if (-not $PrinterName -or $PrinterName.Trim() -eq "") {
    $pDef = Get-CimInstance Win32_Printer | Where-Object Default | Select-Object -First 1
    if ($pDef) {
        $PrinterName = $pDef.Name
    } else {
        $pPos = Get-CimInstance Win32_Printer | Where-Object { $_.Name -match "POS|80|Thermal|Receipt|Xprinter|Epson|Custom|Stampante" } | Select-Object -First 1
        if ($pPos) {
            $PrinterName = $pPos.Name
        } else {
            $pAny = Get-CimInstance Win32_Printer | Select-Object -First 1
            if ($pAny) { $PrinterName = $pAny.Name }
        }
    }
}

if (-not $PrinterName) {
    Write-Error "Nessuna stampante di sistema trovata su Windows."
    exit 1
}

$csharpSource = @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

    public static bool SendFileToPrinter(string szPrinterName, string szFileName) {
        if (!File.Exists(szFileName)) return false;
        byte[] bytes = File.ReadAllBytes(szFileName);
        int nLength = bytes.Length;
        if (nLength == 0) return true;

        IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(nLength);
        Marshal.Copy(bytes, 0, pUnmanagedBytes, nLength);

        IntPtr hPrinter = IntPtr.Zero;
        DOCINFOA di = new DOCINFOA();
        di.pDocName = "SagraPOS Scontrino";
        di.pDataType = "RAW";

        bool bSuccess = false;
        if (OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {
            if (StartDocPrinter(hPrinter, 1, di)) {
                if (StartPagePrinter(hPrinter)) {
                    int dwWritten = 0;
                    bSuccess = WritePrinter(hPrinter, pUnmanagedBytes, nLength, out dwWritten);
                    EndPagePrinter(hPrinter);
                }
                EndDocPrinter(hPrinter);
            }
            ClosePrinter(hPrinter);
        }
        Marshal.FreeCoTaskMem(pUnmanagedBytes);
        return bSuccess;
    }
}
"@

try {
    if (-not ([System.Management.Automation.PSTypeName]'RawPrinterHelper').Type) {
        Add-Type -TypeDefinition $csharpSource
    }
    $res = [RawPrinterHelper]::SendFileToPrinter($PrinterName, $FilePath)
    if ($res) {
        Write-Output "OK: Stampato con successo su '$PrinterName'"
        exit 0
    } else {
        Write-Error "Impossibile scrivere sulla stampante '$PrinterName' via Win32 Spooler (Verifica che sia accesa e online)."
        exit 1
    }
} catch {
    Write-Error "Errore RawPrinterHelper: $($_.Exception.Message)"
    exit 1
}
