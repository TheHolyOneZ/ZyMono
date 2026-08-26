using System;
using System.Collections.Concurrent;
using System.Threading;

namespace ZyMono.Receiver
{

    public class Dispatcher
    {
        private readonly ConcurrentQueue<Action> _queue = new ConcurrentQueue<Action>();

        public void Pump()
        {
            while (_queue.TryDequeue(out var action))
            {
                try { action(); }
                catch (Exception e) { Plugin.Log?.LogError("Dispatcher action failed: " + e); }
            }
        }

        public T RunBlocking<T>(Func<T> func, int timeoutMs)
        {
            T result = default;
            Exception error = null;
            using (var done = new ManualResetEventSlim(false))
            {
                _queue.Enqueue(() =>
                {
                    try { result = func(); }
                    catch (Exception e) { error = e; }
                    finally { done.Set(); }
                });

                if (!done.Wait(timeoutMs))
                    throw new TimeoutException("main-thread work did not complete in time");
            }
            if (error != null) throw error;
            return result;
        }
    }
}
