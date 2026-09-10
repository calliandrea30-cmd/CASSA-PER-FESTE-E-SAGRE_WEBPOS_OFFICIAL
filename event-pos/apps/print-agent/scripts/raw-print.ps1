param (
    [string]$PrinterName = "",
    [string]$FilePath = ""
)

$ErrorActionPreference = "Stop"

if (-not $FilePath -or -not (Test-Path $FilePath)) {
    Write-Error "File non trovato: $FilePath"
    exit 1
}

# Se il nome della stampante non e fornito, recupera velocemente la predefinita di Windows
if (-not $PrinterName -or $PrinterName.Trim() -eq "") {
    try {
        $regVal = (Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Windows' -ErrorAction SilentlyContinue).Device
        if ($regVal) { $PrinterName = $regVal.Split(',')[0].Trim() }
    } catch {}

    if (-not $PrinterName) {
        try {
            $cimDef = Get-CimInstance Win32_Printer | Where-Object { $_.Default -eq $true } | Select-Object -First 1
            if ($cimDef -and $cimDef.Name) { $PrinterName = $cimDef.Name }
        } catch {}
    }

    if (-not $PrinterName) {
        try {
            $pPos = Get-CimInstance Win32_Printer | Where-Object { $_.Name -match "^POS" } | Select-Object -First 1
            if ($pPos) { $PrinterName = $pPos.Name }
        } catch {}
    }

    if (-not $PrinterName) {
        try {
            $pThermal = Get-CimInstance Win32_Printer | Where-Object { $_.Name -match "80|58|Thermal|Receipt|Xprinter|Epson|Custom|Stampante|Scontrin" } | Select-Object -First 1
            if ($pThermal) { $PrinterName = $pThermal.Name }
        } catch {}
    }
}

if (-not $PrinterName) {
    Write-Error "Nessuna stampante trovata su Windows."
    exit 1
}

# Helper Win32 Spooler ad altissime prestazioni e compatibilita Unicode
$csharpSource = @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
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

    public static bool SendFileToPrinter(string szPrinterName, string szFileName) {
        if (!File.Exists(szFileName)) return false;
        byte[] bytes = File.ReadAllBytes(szFileName);
        int nLength = bytes.Length;
        if (nLength == 0) return true;

        IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(nLength);
        Marshal.Copy(bytes, 0, pUnmanagedBytes, nLength);

        IntPtr hPrinter = IntPtr.Zero;
        DOCINFOW di = new DOCINFOW();
        di.pDocName = "SagraPOS Scontrino";
        di.pDataType = "RAW";

        bool bSuccess = false;
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
