using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;
using LingoLife.Original;

public static class BuildOriginalPreview
{
    [MenuItem("LingoLife/Build Original Preview for macOS")]
    public static void MacOS()
    {
        var asset = AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/Resources/OriginalTown.json");
        if (asset == null) throw new InvalidOperationException("Export Assets/Resources/OriginalTown.json first.");
        var data = JsonUtility.FromJson<TownSource>(asset.text);
        if (data.version != 1 || data.presets == null || data.presets.Length < 1)
            throw new InvalidOperationException("Invalid shared asset document.");
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        new GameObject("Original shared scene").AddComponent<OriginalTownPreview>();
        Directory.CreateDirectory("Assets/Scenes");
        EditorSceneManager.SaveScene(scene, "Assets/Scenes/OriginalPreview.unity");
        PlayerSettings.companyName = "LingoLife";
        PlayerSettings.productName = "LingoLife Original Unity";
        PlayerSettings.colorSpace = ColorSpace.Linear;
        PlayerSettings.defaultScreenWidth = 1380; PlayerSettings.defaultScreenHeight = 920;
        PlayerSettings.fullScreenMode = FullScreenMode.Windowed;
        PlayerSettings.SetScriptingBackend(NamedBuildTarget.Standalone, ScriptingImplementation.Mono2x);
        var graphics = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/GraphicsSettings.asset");
        if (graphics.Length > 0)
        {
            var serialized = new SerializedObject(graphics[0]);
            var shaders = serialized.FindProperty("m_AlwaysIncludedShaders");
            int index = shaders.arraySize; shaders.InsertArrayElementAtIndex(index);
            shaders.GetArrayElementAtIndex(index).objectReferenceValue = Shader.Find("Standard");
            serialized.ApplyModifiedPropertiesWithoutUndo();
        }
        var result = BuildPipeline.BuildPlayer(new BuildPlayerOptions {
            scenes = new[] { "Assets/Scenes/OriginalPreview.unity" },
            locationPathName = "Builds/LingoLife Original Unity.app",
            target = BuildTarget.StandaloneOSX,
            options = BuildOptions.None
        });
        if (result.summary.result != BuildResult.Succeeded)
            throw new InvalidOperationException("Unity build failed: " + result.summary.result);
        Debug.Log("Original shared-source Unity player built successfully.");
    }
}
