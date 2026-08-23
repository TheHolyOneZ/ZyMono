using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;

namespace ZyMono.Receiver
{

    internal class PipeServer
    {
        private const string PipeName = "zymono-receiver";
        private readonly Dispatcher _dispatcher;
        private Thread _thread;
        private volatile bool _running;

        public PipeServer(Dispatcher dispatcher)
        {
            _dispatcher = dispatcher;
        }

        public void Start()
        {
            _running = true;
            _thread = new Thread(Loop) { IsBackground = true, Name = "ZyMonoReceiverPipe" };
            _thread.Start();
        }

        public void Stop()
        {
            _running = false;
        }

        private void Loop()
        {
            while (_running)
            {
                try
                {
                    using (var server = new NamedPipeServerStream(
                        PipeName, PipeDirection.InOut, 1,
                        PipeTransmissionMode.Byte, PipeOptions.None))
                    {
                        server.WaitForConnection();
                        Handle(server);
                    }
                }
                catch (Exception e)
                {
                    Plugin.Log?.LogWarning("pipe loop: " + e.Message);
                    Thread.Sleep(200);
                }
            }
        }

        private void Handle(NamedPipeServerStream server)
        {
            string request = ReadFrame(server);
            if (request == null) return;

            string response;
            try
            {
                var msg = Json.Parse(request);
                string op = msg.TryGetValue("op", out var o) ? o as string : "";
                if (op == "PING") response = Hello();
                else if (op == "LOAD") response = HandleLoad(msg);
                else if (op == "INVOKE") response = HandleInvoke(msg);
                else response = Ack(false, null, "unknown op: " + op);
            }
            catch (Exception e)
            {
                response = Ack(false, null, e.Message);
            }

            WriteFrame(server, response);
            try { server.WaitForPipeDrain(); } catch { }
        }

        private string Hello()
        {
            string game = "";
            try { game = UnityEngine.Application.productName; } catch { }
            return "{\"op\":\"HELLO\",\"version\":\"" + Plugin.Version
                + "\",\"game\":\"" + Json.Escape(game)
                + "\",\"mono_domain_ready\":true}";
        }

        private string HandleLoad(Dictionary<string, object> msg)
        {
            string path = msg.TryGetValue("path", out var p) ? p as string : null;
            string type = msg.TryGetValue("type", out var t) ? t as string : null;
            string method = msg.TryGetValue("method", out var m) ? m as string : null;
            string[] args = ExtractArgs(msg);

            if (string.IsNullOrEmpty(path)) return Ack(false, null, "no path");
            Plugin.Log?.LogInfo($"LOAD {path} :: {type}.{method}");

            try
            {
                string ret = _dispatcher.RunBlocking(
                    () => Loader.Load(path, type, method, args), 30000);
                return Ack(true, ret, null);
            }
            catch (Exception e)
            {
                var inner = e.InnerException ?? e;
                Plugin.Log?.LogError("load failed: " + inner);
                return Ack(false, null, inner.GetType().Name + ": " + inner.Message);
            }
        }

        private string HandleInvoke(Dictionary<string, object> msg)
        {
            string assembly = msg.TryGetValue("assembly", out var a) ? a as string : null;
            string type = msg.TryGetValue("type", out var t) ? t as string : null;
            string method = msg.TryGetValue("method", out var m) ? m as string : null;
            string[] args = ExtractArgs(msg);

            if (string.IsNullOrEmpty(assembly)) return Ack(false, null, "no assembly");
            Plugin.Log?.LogInfo($"INVOKE {assembly} :: {type}.{method}");

            try
            {
                string ret = _dispatcher.RunBlocking(
                    () => Loader.Invoke(assembly, type, method, args), 30000);
                return Ack(true, ret, null);
            }
            catch (Exception e)
            {
                var inner = e.InnerException ?? e;
                Plugin.Log?.LogError("invoke failed: " + inner);
                return Ack(false, null, inner.GetType().Name + ": " + inner.Message);
            }
        }

        private static string[] ExtractArgs(Dictionary<string, object> msg)
        {
            if (msg.TryGetValue("args", out var a) && a is List<object> list)
            {
                var arr = new string[list.Count];
                for (int i = 0; i < list.Count; i++) arr[i] = list[i]?.ToString();
                return arr;
            }
            return new string[0];
        }

        private static string Ack(bool ok, string ret, string ex)
        {
            var sb = new StringBuilder();
            sb.Append("{\"op\":\"ACK\",\"status\":\"").Append(ok ? "ok" : "error").Append("\"");
            if (ret != null) sb.Append(",\"return_value\":\"").Append(Json.Escape(ret)).Append("\"");
            if (ex != null) sb.Append(",\"exception\":\"").Append(Json.Escape(ex)).Append("\"");
            sb.Append("}");
            return sb.ToString();
        }

        private static string ReadFrame(Stream s)
        {
            byte[] len = ReadExact(s, 4);
            if (len == null) return null;
            int n = BitConverter.ToInt32(len, 0);
            if (n <= 0 || n > 8 * 1024 * 1024) return null;
            byte[] body = ReadExact(s, n);
            if (body == null) return null;
            return Encoding.UTF8.GetString(body);
        }

        private static void WriteFrame(Stream s, string text)
        {
            byte[] body = Encoding.UTF8.GetBytes(text);
            byte[] len = BitConverter.GetBytes(body.Length);
            s.Write(len, 0, 4);
            s.Write(body, 0, body.Length);
            s.Flush();
        }

        private static byte[] ReadExact(Stream s, int n)
        {
            byte[] buf = new byte[n];
            int got = 0;
            while (got < n)
            {
                int r = s.Read(buf, got, n - got);
                if (r <= 0) return null;
                got += r;
            }
            return buf;
        }
    }
}
