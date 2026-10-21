using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace LingoLife.Original
{
    [Serializable] public class MaterialSource
    {
        public float[] color;
        public float roughness = .65f;
        public float metalness;
        public float[] emissive;
        public float opacity = 1;
        public bool transparent;
    }
    [Serializable] public class GeometrySource
    {
        public string id;
        public float[] positions;
        public float[] normals;
        public float[] uvs;
        public int[] indices;
    }
    [Serializable] public class MeshSource
    {
        public string geometryId;
        public float[] positions;
        public float[] normals;
        public float[] uvs;
        public int[] indices;
        public MaterialSource material;
    }
    [Serializable] public class NodeSource
    {
        public string name;
        public bool visible = true;
        public float[] position;
        public float[] rotation;
        public float[] scale;
        public NodeSource[] children;
        public MeshSource mesh;
    }
    [Serializable] public class PresetSource { public string id; public string name; public NodeSource root; }
    [Serializable] public class TownSource { public int version; public NodeSource root; public PresetSource[] presets; public GeometrySource[] geometries; }

    // The browser exporter owns all geometry. This adapter only changes handedness and shader inputs.
    public sealed class SharedGeometryImporter
    {
        public int MeshCount { get; private set; }
        public int TriangleCount { get; private set; }
        readonly Dictionary<string, GeometrySource> geometries = new Dictionary<string, GeometrySource>();
        readonly Dictionary<string, Mesh> meshes = new Dictionary<string, Mesh>();
        public SharedGeometryImporter(GeometrySource[] pool = null)
        {
            if (pool != null) foreach (var geometry in pool) geometries[geometry.id] = geometry;
        }
        public GameObject Import(NodeSource source)
        {
            var node = new GameObject(string.IsNullOrEmpty(source.name) ? "original-node" : source.name);
            node.SetActive(source.visible);
            node.transform.localPosition = Position(source.position);
            node.transform.localScale = Vector(source.scale, Vector3.one);
            if (source.rotation != null && source.rotation.Length == 4)
                node.transform.localRotation = new Quaternion(-source.rotation[0], -source.rotation[1], source.rotation[2], source.rotation[3]);
            if (source.mesh != null)
            {
                var input = source.mesh;
                if (!string.IsNullOrEmpty(input.geometryId) && geometries.TryGetValue(input.geometryId, out var pooled))
                {
                    input.positions = pooled.positions; input.normals = pooled.normals; input.uvs = pooled.uvs; input.indices = pooled.indices;
                }
                if (input.positions == null || input.positions.Length % 3 != 0 || input.indices == null || input.indices.Length % 3 != 0)
                    throw new InvalidOperationException("Invalid original mesh: " + source.name);
                var count = input.positions.Length / 3;
                var vertices = new Vector3[count];
                var normals = new Vector3[count];
                for (var i = 0; i < count; i++)
                {
                    vertices[i] = new Vector3(input.positions[i * 3], input.positions[i * 3 + 1], -input.positions[i * 3 + 2]);
                    if (input.normals != null && input.normals.Length == input.positions.Length)
                        normals[i] = new Vector3(input.normals[i * 3], input.normals[i * 3 + 1], -input.normals[i * 3 + 2]);
                }
                var triangles = (int[])input.indices.Clone();
                for (var i = 0; i < triangles.Length; i += 3)
                {
                    var value = triangles[i]; triangles[i] = triangles[i + 2]; triangles[i + 2] = value;
                }
                var mesh = new Mesh { name = source.name, indexFormat = count > 65535 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
                mesh.vertices = vertices; mesh.triangles = triangles;
                if (input.normals != null && input.normals.Length == input.positions.Length) mesh.normals = normals;
                else mesh.RecalculateNormals();
                if (input.uvs != null && input.uvs.Length == count * 2)
                {
                    var uv = new Vector2[count];
                    for (var i = 0; i < count; i++) uv[i] = new Vector2(input.uvs[i * 2], input.uvs[i * 2 + 1]);
                    mesh.uv = uv;
                }
                mesh.RecalculateBounds();
                if (!string.IsNullOrEmpty(input.geometryId))
                {
                    if (meshes.TryGetValue(input.geometryId, out var shared)) { UnityEngine.Object.Destroy(mesh); mesh = shared; }
                    else meshes[input.geometryId] = mesh;
                }
                node.AddComponent<MeshFilter>().sharedMesh = mesh;
                var renderer = node.AddComponent<MeshRenderer>();
                var inputMaterial = input.material ?? new MaterialSource();
                var shader = Shader.Find("Standard");
                if (shader == null) throw new InvalidOperationException("Standard shader must be included in player settings.");
                var material = new Material(shader) { name = source.name + "-material" };
                material.color = ColorValue(inputMaterial.color, Color.white).gamma;
                material.SetFloat("_Metallic", inputMaterial.metalness);
                material.SetFloat("_Glossiness", 1 - inputMaterial.roughness);
                var emission = ColorValue(inputMaterial.emissive, Color.black);
                if (emission.maxColorComponent > 0) { material.EnableKeyword("_EMISSION"); material.SetColor("_EmissionColor", emission); }
                if (inputMaterial.transparent)
                {
                    var color = material.color; color.a = inputMaterial.opacity; material.color = color;
                    material.SetFloat("_Mode", 3);
                    material.SetInt("_SrcBlend", (int)BlendMode.One);
                    material.SetInt("_DstBlend", (int)BlendMode.OneMinusSrcAlpha);
                    material.SetInt("_ZWrite", 0);
                    material.EnableKeyword("_ALPHAPREMULTIPLY_ON");
                    material.renderQueue = (int)RenderQueue.Transparent;
                    renderer.shadowCastingMode = ShadowCastingMode.Off;
                }
                renderer.sharedMaterial = material;
                MeshCount++; TriangleCount += triangles.Length / 3;
            }
            if (source.children != null) foreach (var child in source.children)
            {
                var result = Import(child); result.transform.SetParent(node.transform, false);
            }
            return node;
        }
        static Vector3 Vector(float[] v, Vector3 fallback) => v != null && v.Length >= 3 ? new Vector3(v[0], v[1], v[2]) : fallback;
        static Vector3 Position(float[] v) { var result = Vector(v, Vector3.zero); result.z = -result.z; return result; }
        static Color ColorValue(float[] v, Color fallback) => v != null && v.Length >= 3 ? new Color(v[0], v[1], v[2]) : fallback;
    }

    public sealed class OriginalTownPreview : MonoBehaviour
    {
        Camera cameraView;
        Light sun;
        TownSource data;
        readonly List<GameObject> residents = new List<GameObject>();
        readonly Dictionary<Transform, Quaternion> rotations = new Dictionary<Transform, Quaternion>();
        Transform head;
        Vector3 headScale;
        int selected;
        int action;
        int day;
        bool highQuality = true;
        float height = 1, width = 1, headWidth = 1, headSize = 1;
        float yaw = -8, pitch = 16, distance = 12;
        Vector3 target = new Vector3(0, 1.5f, -3);
        string error;
        GUIStyle title, text;

        void Start()
        {
            try
            {
                var asset = Resources.Load<TextAsset>("OriginalTown");
                if (asset == null) throw new InvalidOperationException("Export OriginalTown.json from the browser scene first.");
                data = JsonUtility.FromJson<TownSource>(asset.text);
                if (data.version != 1 || data.presets == null || data.presets.Length == 0)
                    throw new InvalidOperationException("Invalid original asset version or presets.");
                var importer = new SharedGeometryImporter(data.geometries);
                importer.Import(data.root).SetActive(true);
                foreach (var preset in data.presets)
                {
                    var resident = importer.Import(preset.root);
                    resident.transform.position = new Vector3(-1.55f, 0, -3);
                    resident.SetActive(false); residents.Add(resident);
                }
                var friend = importer.Import(data.presets[Math.Min(1, data.presets.Length - 1)].root);
                friend.SetActive(true);
                friend.transform.position = new Vector3(1.55f, 0, -2.8f);
                friend.transform.rotation = Quaternion.Euler(0, 12, 0);
                Select(0);
                Debug.Log($"Original shared scene imported: {importer.MeshCount} meshes, {importer.TriangleCount} triangles.");
            }
            catch (Exception exception) { error = exception.Message; Debug.LogException(exception); }
            cameraView = new GameObject("Original camera").AddComponent<Camera>();
            cameraView.fieldOfView = 36; cameraView.nearClipPlane = .1f; cameraView.farClipPlane = 180;
            cameraView.allowHDR = true;
            sun = new GameObject("Original sunlight").AddComponent<Light>();
            sun.type = LightType.Directional; sun.transform.rotation = Quaternion.Euler(48, -35, 0);
            sun.shadows = LightShadows.Soft; sun.shadowStrength = .55f;
            QualitySettings.shadowDistance = 55; QualitySettings.antiAliasing = 4;
            SetDay(0);
            Application.targetFrameRate = 60;
        }

        void Select(int index)
        {
            selected = index; rotations.Clear();
            for (var i = 0; i < residents.Count; i++) residents[i].SetActive(i == index);
            var root = residents[index].transform;
            foreach (var part in root.GetComponentsInChildren<Transform>()) rotations[part] = part.localRotation;
            head = Find("orig-head"); headScale = head ? head.localScale : Vector3.one;
            height = width = headWidth = headSize = 1;
        }
        Transform Find(string name)
        {
            if (residents.Count == 0) return null;
            foreach (var part in residents[selected].GetComponentsInChildren<Transform>()) if (part.name == name) return part;
            return null;
        }
        void Rotate(string name, float x = 0, float y = 0, float z = 0)
        {
            var part = Find(name); if (part) part.localRotation *= Quaternion.Euler(-x, -y, z);
        }
        void Update()
        {
            if (cameraView == null) return;
            if (Input.GetMouseButton(0) && Input.mousePosition.x > 310)
            {
                yaw += Input.GetAxis("Mouse X") * 3;
                pitch = Mathf.Clamp(pitch - Input.GetAxis("Mouse Y") * 2, 5, 80);
            }
            distance = Mathf.Clamp(distance - Input.mouseScrollDelta.y, 4, 42);
            cameraView.transform.position = target + Quaternion.Euler(pitch, yaw, 0) * new Vector3(0, 0, -distance);
            cameraView.transform.LookAt(target);
            if (residents.Count == 0) return;
            foreach (var pose in rotations) pose.Key.localRotation = pose.Value;
            var resident = residents[selected].transform;
            resident.localScale = new Vector3(1, height, 1);
            var body = Find("orig-root");
            if (body) foreach (Transform part in body)
            {
                if (part.name != "orig-head") part.localScale = new Vector3(width, 1, 1);
            }
            resident.position = new Vector3(-1.55f, Mathf.Sin(Time.time * 2.2f) * .009f, -3);
            if (head) head.localScale = Vector3.Scale(headScale, new Vector3(headWidth * headSize, headSize, headSize));
            float stride = Mathf.Sin(Time.time * 6) * 20;
            switch (action)
            {
                case 1: Rotate("orig-arm-right", -14, 0, -72 + Mathf.Sin(Time.time * 7) * 8); Rotate("orig-forearm-right", -74); break;
                case 2: Rotate("orig-leg-left", stride); Rotate("orig-leg-right", -stride); Rotate("orig-arm-left", -stride * .6f); Rotate("orig-arm-right", stride * .6f); break;
                case 3: Rotate("orig-head", Mathf.Sin(Time.time * 3) * 2, Mathf.Sin(Time.time * 1.7f) * 4); Rotate("orig-arm-right", -8, 0, 14); break;
                case 4: Rotate("orig-arm-left", -40, 0, 12); Rotate("orig-arm-right", -40, 0, -12); Rotate("orig-forearm-left", -28); Rotate("orig-forearm-right", -28); break;
                case 5: Rotate("orig-arm-right", -48); Rotate("orig-forearm-right", -40 + Mathf.Sin(Time.time * 2.5f) * 9); break;
                case 6: Rotate("orig-arm-left", 0, 0, 25); Rotate("orig-arm-right", 0, 0, -25); resident.position += Vector3.up * Mathf.Max(0, Mathf.Sin(Time.time * 4)) * .08f; break;
            }
        }
        void SetDay(int next)
        {
            day = next;
            bool night = day == 2;
            cameraView.backgroundColor = night ? new Color(.13f, .19f, .27f) : day == 1 ? new Color(.9f, .76f, .67f) : new Color(.83f, .87f, .84f);
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = night ? new Color(.36f, .44f, .6f) : new Color(.85f, .86f, .82f);
            RenderSettings.ambientEquatorColor = night ? new Color(.25f, .31f, .39f) : new Color(.64f, .64f, .58f);
            RenderSettings.ambientGroundColor = new Color(.3f, .28f, .24f);
            sun.intensity = night ? .6f : 1.1f;
            sun.color = night ? new Color(.65f, .75f, 1) : day == 1 ? new Color(1, .72f, .48f) : new Color(1, .91f, .77f);
        }
        void OnGUI()
        {
            if (title == null)
            {
                var font = Font.CreateDynamicFontFromOSFont(new[] { "PingFang SC", "Microsoft YaHei", "Arial" }, 18);
                GUI.skin.font = font;
                title = new GUIStyle(GUI.skin.label) { fontSize = 25, fontStyle = FontStyle.Bold };
                text = new GUIStyle(GUI.skin.label) { wordWrap = true, fontSize = 13 };
            }
            GUILayout.BeginArea(new Rect(25, 22, 280, Screen.height - 44), GUI.skin.box);
            GUILayout.Label("LingoLife", title);
            GUILayout.Label("原创生活小镇 · Unity 样板", text);
            GUILayout.Space(20);
            if (error != null) GUILayout.Label(error, text);
            else if (data != null)
            {
                for (int i = 0; i < data.presets.Length; i++) if (GUILayout.Button(data.presets[i].name, GUILayout.Height(34))) Select(i);
                height = Slider("身高", height, .84f, 1.16f);
                headWidth = Slider("脸部宽度", headWidth, .83f, 1.17f);
                headSize = Slider("头身比例", headSize, .88f, 1.12f);
                width = Slider("身形饱满", width, .82f, 1.18f);
                GUILayout.Space(15);
                var nextAction = GUILayout.SelectionGrid(action, new[] { "自在", "招呼", "散步", "聊天", "接礼物", "品尝", "开心" }, 2);
                action = nextAction;
                GUILayout.Space(15);
                int nextDay = GUILayout.SelectionGrid(day, new[] { "晴日", "黄昏", "夜晚" }, 3);
                if (nextDay != day) SetDay(nextDay);
                if (GUILayout.Button(highQuality ? "画质：精致" : "画质：轻盈"))
                {
                    highQuality = !highQuality; sun.shadows = highQuality ? LightShadows.Soft : LightShadows.None;
                    QualitySettings.antiAliasing = highQuality ? 4 : 0;
                    Application.targetFrameRate = highQuality ? 60 : 30;
                }
                if (GUILayout.Button("人物近景")) { target = new Vector3(-1.55f, 2.05f, -3); distance = 4.5f; pitch = 5; yaw = 0; }
                if (GUILayout.Button("小镇全景")) { target = new Vector3(0, 1.6f, 1); distance = 28; pitch = 27; yaw = -35; }
                GUILayout.Space(12); GUILayout.Label("拖动旋转 · 滚轮缩放\n独立样板不修改居民存档", text);
            }
            GUILayout.EndArea();
        }
        float Slider(string label, float value, float min, float max)
        {
            GUILayout.Space(10); GUILayout.Label(label + "  " + Mathf.RoundToInt(value * 100) + "%", text);
            return GUILayout.HorizontalSlider(value, min, max);
        }
    }
}
