using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace LingoLife
{
    public sealed class LingoLifeRoom : MonoBehaviour
    {
        private const string ApiUrl = "https://lingolife.api.shimooth.me";
        private readonly Color cream = new Color32(250, 244, 231, 255);
        private readonly Color ink = new Color32(54, 48, 43, 255);
        private readonly Color coral = new Color32(218, 104, 92, 255);
        private LingoLifeApi api;
        private Text statsText, transcriptText, feedbackText, statusText, avatarFace;
        private InputField input;
        private Button sendButton;
        private RectTransform avatar;
        private string animationState = "sad";
        private bool busy;

        private void Awake()
        {
            Application.targetFrameRate = 60;
            api = new LingoLifeApi(ApiUrl);
            BuildUi();
            SetBusy(true, "Connecting to Emma...");
            StartCoroutine(api.GetRoom(ShowRoom, ShowError));
        }

        private void Update()
        {
            if (avatar != null)
            {
                var speed = animationState == "happy" ? 3.2f : 1.6f;
                var distance = animationState == "sad" ? 2f : 5f;
                avatar.anchoredPosition = new Vector2(0, Mathf.Sin(Time.time * speed) * distance);
            }
            if (!busy && input != null && input.isFocused && Input.GetKeyDown(KeyCode.Return)) Send();
        }

        private void BuildUi()
        {
            if (FindObjectOfType<EventSystem>() == null)
            {
                var eventSystem = new GameObject("EventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
                DontDestroyOnLoad(eventSystem);
            }
            var canvas = NewUi("Canvas", null, typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            var canvasComponent = canvas.GetComponent<Canvas>();
            canvasComponent.renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = canvas.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(480, 800);
            scaler.matchWidthOrHeight = .5f;

            var background = Panel("Background", canvas.transform, cream);
            Stretch(background.GetComponent<RectTransform>(), 0, 0, 1, 1);
            var card = Panel("Room", background.transform, Color.white);
            SetRect(card.GetComponent<RectTransform>(), .06f, .04f, .94f, .96f, Vector2.zero, Vector2.zero);

            Label("Emma", card.transform, 29, FontStyle.Bold, TextAnchor.MiddleLeft, .06f, .89f, .94f, .97f);
            statsText = Label("Relationship 35   Mood 35   English 0", card.transform, 16, FontStyle.Normal, TextAnchor.MiddleLeft, .06f, .83f, .94f, .90f);

            var avatarBox = Panel("Emma Placeholder", card.transform, new Color32(244, 220, 211, 255));
            SetRect(avatarBox.GetComponent<RectTransform>(), .19f, .56f, .81f, .82f, Vector2.zero, Vector2.zero);
            avatar = avatarBox.GetComponent<RectTransform>();
            avatarFace = Label("• ᴗ •\nEMMA", avatarBox.transform, 29, FontStyle.Bold, TextAnchor.MiddleCenter, 0, 0, 1, 1);

            var scroll = NewUi("Conversation", card.transform, typeof(Image), typeof(ScrollRect));
            scroll.GetComponent<Image>().color = new Color32(247, 247, 247, 255);
            SetRect(scroll.GetComponent<RectTransform>(), .06f, .27f, .94f, .54f, Vector2.zero, Vector2.zero);
            transcriptText = Label("", scroll.transform, 16, FontStyle.Normal, TextAnchor.UpperLeft, .04f, .04f, .96f, .96f);
            transcriptText.horizontalOverflow = HorizontalWrapMode.Wrap;
            transcriptText.verticalOverflow = VerticalWrapMode.Overflow;

            feedbackText = Label("", card.transform, 13, FontStyle.Italic, TextAnchor.UpperLeft, .06f, .19f, .94f, .26f);
            feedbackText.color = new Color32(73, 116, 91, 255);
            input = Input("Ask Emma something in English...", card.transform, .06f, .10f, .72f, .18f);
            sendButton = Button("Send", card.transform, .74f, .10f, .94f, .18f);
            sendButton.onClick.AddListener(Send);
            statusText = Label("", card.transform, 13, FontStyle.Normal, TextAnchor.MiddleLeft, .06f, .035f, .94f, .095f);
            statusText.color = coral;
        }

        private void ShowRoom(RoomResponse room)
        {
            UpdateStats(room.stats);
            animationState = room.npc == null ? "sad" : room.npc.animation;
            UpdateAvatar();
            var buffer = new StringBuilder();
            if (room.messages != null)
                foreach (var message in room.messages)
                    buffer.Append(message.speaker == "npc" ? "Emma: " : "You: ").AppendLine(message.text).AppendLine();
            transcriptText.text = buffer.ToString().TrimEnd();
            SetBusy(false, "");
        }

        private void Send()
        {
            var message = input.text.Trim();
            if (busy || message.Length == 0) return;
            if (message.Length > 500) { statusText.text = "Please keep your message under 500 characters."; return; }
            transcriptText.text += (transcriptText.text.Length > 0 ? "\n\n" : "") + "You: " + message;
            feedbackText.text = "";
            SetBusy(true, "Emma is thinking...");
            StartCoroutine(api.SendChat(message, response =>
            {
                transcriptText.text += "\n\nEmma: " + response.npc_reply;
                input.text = "";
                UpdateStats(response.stats);
                animationState = response.animation;
                UpdateAvatar();
                if (response.english_feedback != null)
                {
                    var correction = response.english_feedback.corrected_text;
                    feedbackText.text = response.english_feedback.tip;
                    if (!string.IsNullOrEmpty(correction) && correction != message)
                        feedbackText.text += "\nTry: “" + correction + "”";
                }
                SetBusy(false, "");
                input.ActivateInputField();
            }, ShowError));
        }

        private void UpdateStats(Stats stats)
        {
            if (stats != null) statsText.text = "♥ " + stats.relationship + "    ☺ " + stats.mood + "    English " + stats.english_xp;
        }

        private void UpdateAvatar()
        {
            avatarFace.text = animationState == "happy" ? "• ◡ •\nEMMA" : animationState == "sad" ? "• ︵ •\nEMMA" : "• ᴗ •\nEMMA";
            avatar.GetComponent<Image>().color = animationState == "happy" ? new Color32(246, 218, 151, 255) : new Color32(244, 220, 211, 255);
        }

        private void ShowError(string error)
        {
            SetBusy(false, error);
            input.ActivateInputField();
        }

        private void SetBusy(bool value, string status)
        {
            busy = value;
            if (input != null) input.interactable = !value;
            if (sendButton != null) sendButton.interactable = !value;
            if (statusText != null) statusText.text = status;
        }

        private Text Label(string text, Transform parent, int size, FontStyle style, TextAnchor align, float x1, float y1, float x2, float y2)
        {
            var go = NewUi("Text", parent, typeof(Text));
            var label = go.GetComponent<Text>();
            label.text = text; label.font = Resources.GetBuiltinResource<Font>("Arial.ttf"); label.fontSize = size;
            label.fontStyle = style; label.alignment = align; label.color = ink; label.supportRichText = false;
            SetRect(go.GetComponent<RectTransform>(), x1, y1, x2, y2, Vector2.zero, Vector2.zero);
            return label;
        }

        private InputField Input(string placeholder, Transform parent, float x1, float y1, float x2, float y2)
        {
            var go = NewUi("Message Input", parent, typeof(Image), typeof(InputField));
            go.GetComponent<Image>().color = new Color32(241, 238, 233, 255);
            SetRect(go.GetComponent<RectTransform>(), x1, y1, x2, y2, Vector2.zero, Vector2.zero);
            var field = go.GetComponent<InputField>();
            field.textComponent = Label("", go.transform, 16, FontStyle.Normal, TextAnchor.MiddleLeft, .04f, 0, .96f, 1);
            var hint = Label(placeholder, go.transform, 14, FontStyle.Italic, TextAnchor.MiddleLeft, .04f, 0, .96f, 1);
            hint.color = new Color32(145, 140, 134, 255); field.placeholder = hint; field.characterLimit = 500;
            return field;
        }

        private Button Button(string text, Transform parent, float x1, float y1, float x2, float y2)
        {
            var go = NewUi(text, parent, typeof(Image), typeof(Button)); go.GetComponent<Image>().color = coral;
            SetRect(go.GetComponent<RectTransform>(), x1, y1, x2, y2, Vector2.zero, Vector2.zero);
            var label = Label(text, go.transform, 16, FontStyle.Bold, TextAnchor.MiddleCenter, 0, 0, 1, 1); label.color = Color.white;
            return go.GetComponent<Button>();
        }

        private GameObject Panel(string name, Transform parent, Color color)
        {
            var go = NewUi(name, parent, typeof(Image)); go.GetComponent<Image>().color = color; return go;
        }

        private static GameObject NewUi(string name, Transform parent, params System.Type[] types)
        {
            var go = new GameObject(name, types); if (parent != null) go.transform.SetParent(parent, false); return go;
        }

        private static void Stretch(RectTransform rect, float x1, float y1, float x2, float y2)
        {
            SetRect(rect, x1, y1, x2, y2, Vector2.zero, Vector2.zero);
        }

        private static void SetRect(RectTransform rect, float x1, float y1, float x2, float y2, Vector2 minOffset, Vector2 maxOffset)
        {
            rect.anchorMin = new Vector2(x1, y1); rect.anchorMax = new Vector2(x2, y2);
            rect.offsetMin = minOffset; rect.offsetMax = maxOffset;
        }
    }
}
