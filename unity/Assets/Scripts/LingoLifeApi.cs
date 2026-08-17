using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace LingoLife
{
    public sealed class LingoLifeApi
    {
        private const string PlayerIdKey = "lingolife.player_id";
        private readonly string baseUrl;
        private readonly string playerId;

        public LingoLifeApi(string baseUrl)
        {
            this.baseUrl = baseUrl.TrimEnd('/');
            playerId = PlayerPrefs.GetString(PlayerIdKey, "");
            if (string.IsNullOrEmpty(playerId))
            {
                playerId = "unity-" + Guid.NewGuid().ToString("N");
                PlayerPrefs.SetString(PlayerIdKey, playerId);
                PlayerPrefs.Save();
            }
        }

        public IEnumerator GetRoom(Action<RoomResponse> success, Action<string> failure)
        {
            using (var request = UnityWebRequest.Get(baseUrl + "/api/v1/room"))
            {
                request.SetRequestHeader("X-Player-Id", playerId);
                request.timeout = 15;
                yield return request.SendWebRequest();
                Handle(request, success, failure);
            }
        }

        public IEnumerator SendChat(string message, Action<ChatResponse> success, Action<string> failure)
        {
            var body = Encoding.UTF8.GetBytes(JsonUtility.ToJson(new ChatRequest { message = message }));
            using (var request = new UnityWebRequest(baseUrl + "/api/v1/chat", UnityWebRequest.kHttpVerbPOST))
            {
                request.uploadHandler = new UploadHandlerRaw(body);
                request.downloadHandler = new DownloadHandlerBuffer();
                request.SetRequestHeader("Content-Type", "application/json");
                request.SetRequestHeader("X-Player-Id", playerId);
                request.SetRequestHeader("Idempotency-Key", Guid.NewGuid().ToString());
                request.timeout = 30;
                yield return request.SendWebRequest();
                Handle(request, success, failure);
            }
        }

        private static void Handle<T>(UnityWebRequest request, Action<T> success, Action<string> failure)
        {
            var text = request.downloadHandler == null ? "" : request.downloadHandler.text;
            if (request.result == UnityWebRequest.Result.Success)
            {
                try { success(JsonUtility.FromJson<T>(text)); }
                catch (Exception) { failure("The server returned an unreadable response."); }
                return;
            }

            try
            {
                var parsed = JsonUtility.FromJson<ApiErrorBody>(text);
                if (parsed != null && parsed.error != null && !string.IsNullOrEmpty(parsed.error.message))
                {
                    failure(parsed.error.message);
                    return;
                }
            }
            catch (Exception) { }
            failure(request.result == UnityWebRequest.Result.ConnectionError
                ? "Could not reach Emma. Check the server and try again."
                : "Emma needs a moment. Please try again.");
        }
    }
}
