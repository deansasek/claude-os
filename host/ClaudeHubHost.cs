// Claude Hub Host: tray supervisor for the hub Node server plus a loopback control API.
// Compiled with the .NET Framework 4.0 csc.exe (C# 5 language level). See build.ts.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace ClaudeHubHost
{
    internal enum ServerState { Stopped, Running, Restarting }

    internal static class Program
    {
        internal const string AppName = "ClaudeOS Host";
        internal const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        internal const string RunValue = "ClaudeHubHost";

        internal const string DefaultConfigJson = @"{
  ""nodePath"": """",
  ""args"": [
    ""--disable-warning=ExperimentalWarning"",
    ""src\\main.server.ts"",
    ""--port"", ""8000"",
    ""--theme"", ""time""
  ],
  ""workingDir"": """",
  ""apiPort"": 47811,
  ""autostart"": true,
  ""cattPath"": """",
  ""serverUrl"": """"
}
";

        [STAThread]
        static int Main(string[] argv)
        {
            string configArg = null;
            for (int i = 0; i < argv.Length - 1; i++)
                if (argv[i] == "--config") configArg = argv[i + 1];

            bool first;
            Mutex mutex = new Mutex(true, @"Local\ClaudeHubHost.SingleInstance", out first);
            if (!first)
            {
                ShowAlreadyRunning();
                mutex.Close();
                return 0;
            }
            try
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                return RunApp(configArg);
            }
            catch (Exception ex)
            {
                MessageBox.Show("ClaudeOS Host failed:\n\n" + ex.Message, AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            finally
            {
                try { mutex.ReleaseMutex(); } catch (Exception) { }
                mutex.Close();
            }
        }

        static void ShowAlreadyRunning()
        {
            NotifyIcon ni = new NotifyIcon();
            ni.Icon = SystemIcons.Application;
            ni.Text = AppName;
            ni.Visible = true;
            ni.ShowBalloonTip(4000, AppName, "Already running. Look for the icon in the notification area.", ToolTipIcon.Info);
            DateTime end = DateTime.UtcNow.AddSeconds(4.5);
            while (DateTime.UtcNow < end) { Application.DoEvents(); Thread.Sleep(50); }
            ni.Visible = false;
            ni.Dispose();
        }

        static int RunApp(string configArg)
        {
            string hostDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            string hubDir = Path.GetFullPath(Path.Combine(hostDir, ".."));
            string configPath = Path.GetFullPath(configArg ?? Path.Combine(hostDir, "host.config.json"));
            Config cfg = Config.Load(configPath, hubDir);

            string logDir = Path.Combine(hostDir, "logs");
            Directory.CreateDirectory(logDir);
            HubLog log = new HubLog(Path.Combine(logDir, "server.log"));
            log.Write("host", "ClaudeHubHost starting, config " + configPath);

            string appData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ClaudeHubHost");
            Directory.CreateDirectory(appData);
            string tokenPath = Path.Combine(appData, "token");
            string token = LoadOrCreateToken(tokenPath);

            // Hidden form: gives the API threads a UI thread to marshal onto.
            Form ui = new Form();
            ui.ShowInTaskbar = false;
            ui.Opacity = 0;
            IntPtr uiHandle = ui.Handle;

            NotifyIcon ni = new NotifyIcon();
            ni.Icon = SystemIcons.Application;
            ni.Text = AppName;
            ni.Visible = true;

            Supervisor sup = new Supervisor(cfg, log, delegate(string title, string text, ToolTipIcon icon)
            {
                ni.ShowBalloonTip(5000, title, text, icon);
            });

            ContextMenuStrip menu = new ContextMenuStrip();
            ToolStripMenuItem miStatus = new ToolStripMenuItem("Status");
            miStatus.Enabled = false;
            ToolStripMenuItem miOpen = new ToolStripMenuItem("Open hub in browser");
            ToolStripMenuItem miStart = new ToolStripMenuItem("Start");
            ToolStripMenuItem miStop = new ToolStripMenuItem("Stop");
            ToolStripMenuItem miRestart = new ToolStripMenuItem("Restart");
            ToolStripMenuItem miLog = new ToolStripMenuItem("Open log");
            ToolStripMenuItem miFolder = new ToolStripMenuItem("Open project folder");
            ToolStripMenuItem miAuto = new ToolStripMenuItem("Start with Windows");
            miAuto.CheckOnClick = true;
            miAuto.Checked = AutoStartEnabled();
            ToolStripMenuItem miExit = new ToolStripMenuItem("Exit");
            menu.Items.Add(miStatus);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(miOpen);
            menu.Items.Add(miStart);
            menu.Items.Add(miStop);
            menu.Items.Add(miRestart);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(miLog);
            menu.Items.Add(miFolder);
            menu.Items.Add(miAuto);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(miExit);
            ni.ContextMenuStrip = menu;

            ApiServer api = new ApiServer(cfg, sup, log, ui, token);
            try
            {
                api.Start();
            }
            catch (Exception ex)
            {
                log.Write("host", "API could not bind " + api.Url + ": " + ex.Message);
                MessageBox.Show("Could not start the control API on " + api.Url + ".\n\n" + ex.Message +
                    "\n\nChange apiPort in host.config.json.", AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                ni.Visible = false;
                ni.Dispose();
                return 1;
            }
            WriteApiFile(appData, api.Url, tokenPath);

            System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
            timer.Interval = 1000;

            Action refresh = delegate
            {
                string tip = sup.Summary();
                if (tip.Length > 63) tip = tip.Substring(0, 63);
                if (ni.Text != tip) ni.Text = tip;
                miStatus.Text = tip;
                miStart.Enabled = sup.State != ServerState.Running;
                miStop.Enabled = sup.State != ServerState.Stopped;
            };

            Action shutdown = delegate
            {
                timer.Stop();
                api.Stop();
                sup.Stop();
                log.Write("host", "ClaudeHubHost exiting");
                ni.Visible = false;
                ni.Dispose();
                Application.Exit();
            };

            miOpen.Click += delegate
            {
                string url = cfg.EffectiveServerUrl();
                if (string.IsNullOrEmpty(url)) ni.ShowBalloonTip(4000, AppName, "No server URL configured.", ToolTipIcon.Warning);
                else Process.Start(url);
            };
            ni.DoubleClick += delegate { miOpen.PerformClick(); };
            miStart.Click += delegate { string err = sup.Start(); if (err != null) ni.ShowBalloonTip(5000, AppName, err, ToolTipIcon.Error); refresh(); };
            miStop.Click += delegate { sup.Stop(); refresh(); };
            miRestart.Click += delegate { string err = sup.Restart(); if (err != null) ni.ShowBalloonTip(5000, AppName, err, ToolTipIcon.Error); refresh(); };
            miLog.Click += delegate
            {
                if (!File.Exists(log.LogPath)) File.WriteAllText(log.LogPath, "");
                Process.Start("notepad.exe", "\"" + log.LogPath + "\"");
            };
            miFolder.Click += delegate { Process.Start("explorer.exe", "\"" + hubDir + "\""); };
            miAuto.Click += delegate
            {
                try { SetAutoStart(miAuto.Checked); }
                catch (Exception ex)
                {
                    miAuto.Checked = !miAuto.Checked;
                    ni.ShowBalloonTip(5000, AppName, "Could not change startup setting: " + ex.Message, ToolTipIcon.Error);
                }
            };
            miExit.Click += delegate { shutdown(); };

            timer.Tick += delegate { sup.Tick(); refresh(); };
            timer.Start();
            Application.ApplicationExit += delegate { sup.Stop(); };

            log.Write("host", "API listening on " + api.Url + ", server URL " + cfg.EffectiveServerUrl());
            if (cfg.Autostart)
            {
                string err = sup.Start();
                if (err != null) ni.ShowBalloonTip(5000, AppName, err, ToolTipIcon.Error);
            }
            refresh();

            Application.Run();
            return 0;
        }

        internal static string FindOnPath(string exe)
        {
            string path = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string dir in path.Split(';'))
            {
                string d = dir.Trim().Trim('"');
                if (d.Length == 0) continue;
                try
                {
                    string candidate = Path.Combine(d, exe);
                    if (File.Exists(candidate)) return candidate;
                }
                catch (Exception) { }
            }
            return null;
        }

        static bool AutoStartEnabled()
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey, false))
                return k != null && k.GetValue(RunValue) != null;
        }

        static void SetAutoStart(bool on)
        {
            if (on)
            {
                using (RegistryKey k = Registry.CurrentUser.CreateSubKey(RunKey))
                    k.SetValue(RunValue, "\"" + Application.ExecutablePath + "\"");
            }
            else
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey, true))
                    if (k != null) k.DeleteValue(RunValue, false);
            }
        }

        static string LoadOrCreateToken(string path)
        {
            if (File.Exists(path))
            {
                string existing = File.ReadAllText(path).Trim();
                if (existing.Length >= 32) return existing;
                File.Delete(path);
            }
            byte[] bytes = new byte[32];
            using (RNGCryptoServiceProvider rng = new RNGCryptoServiceProvider()) rng.GetBytes(bytes);
            string token = BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();

            // Readable only by the current user: protected ACL with a single FullControl entry.
            IdentityReference sid = WindowsIdentity.GetCurrent().User;
            FileSecurity sec = new FileSecurity();
            sec.SetAccessRuleProtection(true, false);
            sec.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl, AccessControlType.Allow));
            using (FileStream fs = new FileStream(path, FileMode.CreateNew, FileSystemRights.FullControl, FileShare.None, 4096, FileOptions.None, sec))
            {
                byte[] b = Encoding.ASCII.GetBytes(token);
                fs.Write(b, 0, b.Length);
            }
            return token;
        }

        static void WriteApiFile(string appData, string url, string tokenPath)
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["url"] = url;
            d["tokenPath"] = tokenPath;
            d["pid"] = Process.GetCurrentProcess().Id;
            File.WriteAllText(Path.Combine(appData, "api.json"), new JavaScriptSerializer().Serialize(d), new UTF8Encoding(false));
        }
    }

    internal sealed class Config
    {
        public string NodePath = "";
        public List<string> Args = new List<string>();
        public string WorkingDir = "";
        public int ApiPort = 47811;
        public bool Autostart = true;
        public string CattPath = "";
        public string ServerUrl = "";

        public static Config Load(string path, string hubDir)
        {
            if (!File.Exists(path))
                File.WriteAllText(path, Program.DefaultConfigJson, new UTF8Encoding(false));

            Dictionary<string, object> d = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(path));
            Config c = new Config();
            c.NodePath = Str(d, "nodePath", "");
            c.Args = Strs(d, "args");
            string wd = Str(d, "workingDir", "");
            c.WorkingDir = wd.Length == 0 ? hubDir : Path.GetFullPath(Path.Combine(hubDir, wd));
            c.ApiPort = Int(d, "apiPort", 47811);
            c.Autostart = Bool(d, "autostart", true);
            c.CattPath = Str(d, "cattPath", "");
            c.ServerUrl = Str(d, "serverUrl", "");
            return c;
        }

        // Server URL for "Open hub" and /health: serverUrl if set, else derived from --host/--port in args.
        public string EffectiveServerUrl()
        {
            if (!string.IsNullOrEmpty(ServerUrl)) return ServerUrl;
            string host = null, port = null;
            for (int i = 0; i < Args.Count; i++)
            {
                string a = Args[i];
                if (a == "--host" && i + 1 < Args.Count) host = Args[i + 1];
                else if (a.StartsWith("--host=")) host = a.Substring(7);
                else if (a == "--port" && i + 1 < Args.Count) port = Args[i + 1];
                else if (a.StartsWith("--port=")) port = a.Substring(7);
            }
            if (host == null && port == null) return "";
            if (string.IsNullOrEmpty(port)) port = "8000";
            if (string.IsNullOrEmpty(host) || host == "0.0.0.0") host = "127.0.0.1";
            return "http://" + host + ":" + port;
        }

        static string Str(Dictionary<string, object> d, string k, string def)
        {
            object v;
            return d.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : def;
        }

        static int Int(Dictionary<string, object> d, string k, int def)
        {
            object v;
            return d.TryGetValue(k, out v) && v != null ? Convert.ToInt32(v) : def;
        }

        static bool Bool(Dictionary<string, object> d, string k, bool def)
        {
            object v;
            return d.TryGetValue(k, out v) && v != null ? Convert.ToBoolean(v) : def;
        }

        static List<string> Strs(Dictionary<string, object> d, string k)
        {
            List<string> list = new List<string>();
            object v;
            if (d.TryGetValue(k, out v) && v != null)
            {
                System.Collections.IEnumerable en = v as System.Collections.IEnumerable;
                if (en != null) foreach (object o in en) list.Add(Convert.ToString(o));
            }
            return list;
        }
    }

    // Rolling server.log (5 MB cap, one .1 backup) plus an in-memory ring of the last 500 lines.
    internal sealed class HubLog
    {
        const long MaxBytes = 5L * 1024 * 1024;
        const int RingSize = 500;
        readonly object gate = new object();
        readonly Queue<string> ring = new Queue<string>();
        StreamWriter writer;

        public readonly string LogPath;

        public HubLog(string path) { LogPath = path; }

        public void Write(string tag, string text)
        {
            string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " [" + tag + "] " + text;
            lock (gate)
            {
                ring.Enqueue(line);
                while (ring.Count > RingSize) ring.Dequeue();
                try
                {
                    if (writer == null) writer = Open();
                    writer.WriteLine(line);
                    if (writer.BaseStream.Position >= MaxBytes) Rotate();
                }
                catch (Exception) { }
            }
        }

        StreamWriter Open()
        {
            FileStream fs = new FileStream(LogPath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
            return new StreamWriter(fs, new UTF8Encoding(false)) { AutoFlush = true };
        }

        void Rotate()
        {
            writer.Dispose();
            writer = null;
            string bak = LogPath + ".1";
            if (File.Exists(bak)) File.Delete(bak);
            File.Move(LogPath, bak);
        }

        public List<string> Recent(int n)
        {
            lock (gate)
            {
                string[] all = ring.ToArray();
                List<string> list = new List<string>();
                for (int i = Math.Max(0, all.Length - n); i < all.Length; i++) list.Add(all[i]);
                return list;
            }
        }
    }

    // Owns the hub child process. All methods run on the UI thread (API calls are marshalled there).
    internal sealed class Supervisor
    {
        static readonly int[] Backoff = { 1, 2, 5, 10, 30 };
        static readonly TimeSpan Healthy = TimeSpan.FromSeconds(60);

        readonly Config cfg;
        readonly HubLog log;
        readonly Action<string, string, ToolTipIcon> notify;
        readonly IntPtr job;

        Process proc;
        ServerState state = ServerState.Stopped;
        DateTime startedAt;
        DateTime restartAt = DateTime.MinValue;
        int restartCount;
        int failIndex;
        int? lastExitCode;
        string lastError = "";

        public Supervisor(Config cfg, HubLog log, Action<string, string, ToolTipIcon> notify)
        {
            this.cfg = cfg;
            this.log = log;
            this.notify = notify;
            // Job object: children die with this process even if it is killed outright.
            job = CreateJobObject(IntPtr.Zero, null);
            if (job != IntPtr.Zero)
            {
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                info.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
                IntPtr ptr = Marshal.AllocHGlobal(size);
                try
                {
                    Marshal.StructureToPtr(info, ptr, false);
                    SetInformationJobObject(job, 9, ptr, (uint)size); // JobObjectExtendedLimitInformation
                }
                finally { Marshal.FreeHGlobal(ptr); }
            }
        }

        public ServerState State { get { return state; } }

        // Returns null on success, otherwise the error message.
        public string Start()
        {
            if (state == ServerState.Running) return null;
            failIndex = 0;
            string err = Launch();
            if (err != null)
            {
                state = ServerState.Stopped;
                lastError = err;
                log.Write("host", err);
            }
            return err;
        }

        public void Stop()
        {
            restartAt = DateTime.MinValue;
            Process p = proc;
            proc = null;
            if (p != null)
            {
                KillTree(p);
                log.Write("host", "server stopped");
                try { p.Dispose(); } catch (Exception) { }
            }
            state = ServerState.Stopped;
        }

        public string Restart()
        {
            Stop();
            return Start();
        }

        public void Tick()
        {
            DateTime now = DateTime.UtcNow;
            if (state == ServerState.Running)
            {
                if (proc != null && proc.HasExited)
                {
                    OnCrashed(now);
                }
                else if (failIndex > 0 && now - startedAt >= Healthy)
                {
                    failIndex = 0;
                }
            }
            if (state == ServerState.Restarting && now >= restartAt)
            {
                string err = Launch();
                if (err != null)
                {
                    lastError = err;
                    log.Write("host", "restart failed: " + err);
                    ScheduleRestart();
                }
            }
        }

        void OnCrashed(DateTime now)
        {
            int code = -1;
            try { code = proc.ExitCode; } catch (Exception) { }
            lastExitCode = code;
            try { proc.Dispose(); } catch (Exception) { }
            proc = null;
            restartCount++;
            if (now - startedAt >= Healthy) failIndex = 0;
            int secs = ScheduleRestart();
            log.Write("host", "server exited with code " + code + "; restart #" + restartCount + " in " + secs + "s");
            notify(Program.AppName, "Hub server exited (code " + code + "). Restarting in " + secs + "s.", ToolTipIcon.Warning);
        }

        int ScheduleRestart()
        {
            int secs = Backoff[Math.Min(failIndex, Backoff.Length - 1)];
            failIndex++;
            restartAt = DateTime.UtcNow.AddSeconds(secs);
            state = ServerState.Restarting;
            return secs;
        }

        // Returns null on success, otherwise an error message. Sets state to Running on success.
        string Launch()
        {
            string node;
            if (string.IsNullOrEmpty(cfg.NodePath)) node = Program.FindOnPath("node.exe");
            else node = File.Exists(cfg.NodePath) ? cfg.NodePath : null;
            if (node == null)
                return string.IsNullOrEmpty(cfg.NodePath)
                    ? "node.exe not found on PATH. Install Node or set nodePath in host.config.json."
                    : "nodePath not found: " + cfg.NodePath;

            List<string> args = new List<string>(cfg.Args);
            if (!string.IsNullOrEmpty(cfg.CattPath)) { args.Add("--catt"); args.Add(cfg.CattPath); }
            StringBuilder sb = new StringBuilder();
            foreach (string a in args)
            {
                if (sb.Length > 0) sb.Append(' ');
                sb.Append(QuoteArg(a));
            }

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = node;
            psi.Arguments = sb.ToString();
            psi.WorkingDirectory = cfg.WorkingDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;

            Process p = new Process();
            p.StartInfo = psi;
            p.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) log.Write("out", e.Data); };
            p.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) log.Write("err", e.Data); };
            try
            {
                p.Start();
            }
            catch (Exception ex)
            {
                p.Dispose();
                return "Could not start node: " + ex.Message;
            }
            if (job != IntPtr.Zero && !AssignProcessToJobObject(job, p.Handle))
                log.Write("host", "warning: could not add server to job object (win32 error " + Marshal.GetLastWin32Error() + ")");
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();

            proc = p;
            state = ServerState.Running;
            startedAt = DateTime.UtcNow;
            restartAt = DateTime.MinValue;
            lastError = "";
            log.Write("host", "started pid " + p.Id + ": " + node + " " + sb);
            return null;
        }

        static void KillTree(Process p)
        {
            try
            {
                if (p.HasExited) return;
                using (Process t = Process.Start(new ProcessStartInfo("taskkill", "/T /F /PID " + p.Id)
                    { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden }))
                {
                    t.WaitForExit(5000);
                }
                if (!p.HasExited)
                {
                    p.Kill();
                    p.WaitForExit(3000);
                }
            }
            catch (Exception) { }
        }

        public Dictionary<string, object> Status()
        {
            DateTime now = DateTime.UtcNow;
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["state"] = state.ToString();
            d["pid"] = proc != null ? (object)proc.Id : null;
            d["uptimeSeconds"] = state == ServerState.Running ? (int)(now - startedAt).TotalSeconds : 0;
            d["restartCount"] = restartCount;
            d["lastExitCode"] = lastExitCode.HasValue ? (object)lastExitCode.Value : null;
            d["nextRestartInSeconds"] = state == ServerState.Restarting ? (object)Math.Max(0, (int)Math.Ceiling((restartAt - now).TotalSeconds)) : null;
            d["serverUrl"] = cfg.EffectiveServerUrl();
            d["lastError"] = lastError;
            return d;
        }

        public string Summary()
        {
            switch (state)
            {
                case ServerState.Running:
                    TimeSpan up = DateTime.UtcNow - startedAt;
                    string upText = up.TotalHours >= 1
                        ? string.Format("{0}h {1:00}m", (int)up.TotalHours, up.Minutes)
                        : string.Format("{0}m {1:00}s", up.Minutes, up.Seconds);
                    return "ClaudeOS: Running, up " + upText + ", PID " + (proc != null ? proc.Id : 0);
                case ServerState.Restarting:
                    int secs = (int)Math.Ceiling((restartAt - DateTime.UtcNow).TotalSeconds);
                    return "ClaudeOS: Restarting in " + Math.Max(0, secs) + "s";
                default:
                    return "ClaudeOS: Stopped";
            }
        }

        static string QuoteArg(string a)
        {
            if (a.Length > 0 && a.IndexOfAny(new char[] { ' ', '\t', '"' }) < 0) return a;
            StringBuilder sb = new StringBuilder("\"");
            int backslashes = 0;
            foreach (char c in a)
            {
                if (c == '\\') { backslashes++; continue; }
                if (c == '"')
                {
                    sb.Append('\\', backslashes * 2 + 1);
                    sb.Append('"');
                }
                else
                {
                    sb.Append('\\', backslashes);
                    sb.Append(c);
                }
                backslashes = 0;
            }
            sb.Append('\\', backslashes * 2);
            sb.Append('"');
            return sb.ToString();
        }

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct IO_COUNTERS
        {
            public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
            public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr CreateJobObject(IntPtr attributes, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    }

    // Loopback-only control API. Every route except nothing needs "Authorization: Bearer <token>".
    internal sealed class ApiServer
    {
        readonly Config cfg;
        readonly Supervisor sup;
        readonly HubLog log;
        readonly Control ui;
        readonly string token;
        readonly int port;
        HttpListener listener;

        public ApiServer(Config cfg, Supervisor sup, HubLog log, Control ui, string token)
        {
            this.cfg = cfg;
            this.sup = sup;
            this.log = log;
            this.ui = ui;
            this.token = token;
            this.port = cfg.ApiPort;
        }

        public string Url { get { return "http://127.0.0.1:" + port + "/"; } }

        public void Start()
        {
            listener = new HttpListener();
            listener.Prefixes.Add(Url);
            listener.Start();
            Thread t = new Thread(Loop);
            t.IsBackground = true;
            t.Start();
        }

        public void Stop()
        {
            try { if (listener != null) listener.Close(); } catch (Exception) { }
        }

        void Loop()
        {
            while (true)
            {
                HttpListenerContext ctx;
                try { ctx = listener.GetContext(); }
                catch (Exception) { break; }
                ThreadPool.QueueUserWorkItem(delegate { Handle(ctx); });
            }
        }

        void Handle(HttpListenerContext ctx)
        {
            int code = 200;
            object body;
            try
            {
                HttpListenerRequest req = ctx.Request;
                if (!Authorized(req))
                {
                    code = 401;
                    body = Err("missing or invalid bearer token");
                }
                else
                {
                    body = Route(req, out code);
                }
            }
            catch (Exception ex)
            {
                code = 500;
                body = Err(ex.Message);
            }
            WriteJson(ctx.Response, code, body);
        }

        bool Authorized(HttpListenerRequest req)
        {
            string h = req.Headers["Authorization"];
            if (h == null) return false;
            string want = "Bearer " + token;
            if (h.Length != want.Length) return false;
            int diff = 0;
            for (int i = 0; i < h.Length; i++) diff |= h[i] ^ want[i];
            return diff == 0;
        }

        object Route(HttpListenerRequest req, out int code)
        {
            code = 200;
            string path = req.Url.AbsolutePath.TrimEnd('/').ToLowerInvariant();
            string method = req.HttpMethod.ToUpperInvariant();
            bool get = method == "GET";
            bool post = method == "POST";

            switch (path)
            {
                case "/status":
                    if (!get) return NotAllowed(out code);
                    return OnUi(delegate { return (object)sup.Status(); });
                case "/start":
                    if (!post) return NotAllowed(out code);
                    return OnUi(delegate { sup.Start(); return (object)sup.Status(); });
                case "/stop":
                    if (!post) return NotAllowed(out code);
                    return OnUi(delegate { sup.Stop(); return (object)sup.Status(); });
                case "/restart":
                    if (!post) return NotAllowed(out code);
                    return OnUi(delegate { sup.Restart(); return (object)sup.Status(); });
                case "/logs":
                    {
                        if (!get) return NotAllowed(out code);
                        int n = 100;
                        string q = req.QueryString["lines"];
                        if (!string.IsNullOrEmpty(q) && !int.TryParse(q, out n)) n = 100;
                        n = Math.Max(1, Math.Min(500, n));
                        Dictionary<string, object> d = new Dictionary<string, object>();
                        List<string> lines = log.Recent(n);
                        d["count"] = lines.Count;
                        d["lines"] = lines;
                        return d;
                    }
                case "/health":
                    if (!get) return NotAllowed(out code);
                    return Probe(cfg.EffectiveServerUrl());
                default:
                    code = 404;
                    return Err("unknown route " + path);
            }
        }

        // Runs on the UI thread, where the Supervisor lives.
        object OnUi(Func<object> f)
        {
            return ui.Invoke(f);
        }

        static object NotAllowed(out int code)
        {
            code = 405;
            return Err("method not allowed");
        }

        static Dictionary<string, object> Err(string message)
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["error"] = message;
            return d;
        }

        static Dictionary<string, object> Probe(string url)
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["url"] = url;
            if (string.IsNullOrEmpty(url))
            {
                d["healthy"] = false;
                d["error"] = "no server URL configured";
                return d;
            }
            try
            {
                HttpWebRequest r = (HttpWebRequest)WebRequest.Create(url);
                r.Method = "GET";
                r.Timeout = 3000;
                r.ReadWriteTimeout = 3000;
                r.AllowAutoRedirect = false;
                r.Proxy = null;
                using (HttpWebResponse resp = (HttpWebResponse)r.GetResponse())
                {
                    d["healthy"] = true;
                    d["httpStatus"] = (int)resp.StatusCode;
                }
            }
            catch (WebException ex)
            {
                HttpWebResponse resp = ex.Response as HttpWebResponse;
                if (resp != null)
                {
                    // Any HTTP answer means the server is up, even an error status.
                    d["healthy"] = true;
                    d["httpStatus"] = (int)resp.StatusCode;
                    resp.Close();
                }
                else
                {
                    d["healthy"] = false;
                    d["error"] = ex.Message;
                }
            }
            catch (Exception ex)
            {
                d["healthy"] = false;
                d["error"] = ex.Message;
            }
            return d;
        }

        static void WriteJson(HttpListenerResponse res, int code, object body)
        {
            try
            {
                byte[] b = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(body ?? new Dictionary<string, object>()));
                res.StatusCode = code;
                res.ContentType = "application/json; charset=utf-8";
                res.ContentLength64 = b.Length;
                res.OutputStream.Write(b, 0, b.Length);
            }
            catch (Exception) { }
            finally
            {
                try { res.Close(); } catch (Exception) { }
            }
        }
    }
}
