using UnityEngine;

namespace LingoLife
{
    public static class LingoLifeBootstrap
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void Start()
        {
            if (Object.FindObjectOfType<LingoLifeRoom>() != null) return;
            new GameObject("LingoLife Room").AddComponent<LingoLifeRoom>();
        }
    }
}
