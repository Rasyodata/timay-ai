// Windows ekran koruyucusu (TimayPlatform.scr).
// Windows bunu /s (göster), /p (önizleme) ve /c (ayar) ile çalıştırır.
// /s gelince kurulu Timay programını "--ekran-koruyucu" ile tam ekran açar ve kapanmasını bekler.
// Windows'ta "Sürdürmede oturum açma ekranını göster" seçiliyse kapanınca Windows şifresi sorulur.
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using Microsoft.Win32;

static class TimayEkranKoruyucu
{
    [STAThread]
    static int Main(string[] args)
    {
        string mode = args.Length > 0 ? args[0].ToLowerInvariant() : "/c";
        if (mode.StartsWith("/p")) return 0; // küçük önizleme penceresi: gösterilmez
        if (mode.StartsWith("/c"))
        {
            MessageBox.Show("Timay Platform Hukuk Yazılımı ekran koruyucusu.\n\nAyar gerekmez. Bekleme süresini ve şifre sorulmasını Windows'un Ekran Koruyucu Ayarları'ndan seçebilirsiniz.",
                "Timay Platform", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        if (!mode.StartsWith("/s")) return 0;

        string exe = FindTimay();
        if (exe == null)
        {
            MessageBox.Show("Timay Platform programı bulunamadı. Lütfen programı yeniden kurun.", "Timay Platform");
            return 1;
        }
        var info = new ProcessStartInfo(exe, "--ekran-koruyucu");
        info.UseShellExecute = false;
        info.WorkingDirectory = Path.GetDirectoryName(exe);
        using (var p = Process.Start(info)) p.WaitForExit();
        return 0;
    }

    static string FindTimay()
    {
        foreach (RegistryHive hive in new[] { RegistryHive.LocalMachine, RegistryHive.CurrentUser })
            foreach (RegistryView view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
            {
                try
                {
                    using (RegistryKey b = RegistryKey.OpenBaseKey(hive, view))
                    using (RegistryKey k = b.OpenSubKey(@"Software\TimayPlatform"))
                    {
                        string v = k == null ? null : k.GetValue("Exe") as string;
                        if (v != null && File.Exists(v)) return v;
                    }
                }
                catch (Exception) { }
            }
        string here = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Timay.exe");
        if (File.Exists(here)) return here;
        string pf = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Timay\Timay.exe");
        if (File.Exists(pf)) return pf;
        string local = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\Timay\Timay.exe");
        if (File.Exists(local)) return local;
        return null;
    }
}
