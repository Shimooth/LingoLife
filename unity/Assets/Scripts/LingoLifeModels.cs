using System;

namespace LingoLife
{
    [Serializable] public class NpcInfo { public string id; public string name; public string animation; }
    [Serializable] public class Stats { public int relationship; public int mood; public int english_xp; }
    [Serializable] public class ChatMessage { public string speaker; public string text; }
    [Serializable] public class RoomResponse { public string room_id; public NpcInfo npc; public Stats stats; public ChatMessage[] messages; }
    [Serializable] public class ChatRequest { public string message; }
    [Serializable] public class EnglishFeedback
    {
        public bool is_understandable;
        public string corrected_text;
        public string tip;
        public string[] tags;
    }
    [Serializable] public class ChatResponse
    {
        public string npc_reply;
        public int relationship_change;
        public int mood_change;
        public int english_xp_change;
        public Stats stats;
        public string animation;
        public EnglishFeedback english_feedback;
    }
    [Serializable] public class ApiErrorBody { public ApiError error; }
    [Serializable] public class ApiError { public string code; public string message; }
}
