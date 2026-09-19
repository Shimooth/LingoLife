import json
from pathlib import Path

import pytest

from lingolife.agent import dialogue_objective
from lingolife.ai import DeepSeekProvider, _persona_prompt
from lingolife.config import Settings
from lingolife.life_expression import ANIMATIONS, ENDINGS, SYSTEM_PROMPT
from lingolife.prompt_localization import event_prompt_data, localize_event_objective


def is_chinese(value):
    return any('\u4e00' <= char <= '\u9fff' for char in value)


@pytest.mark.parametrize('stage', ['stranger', 'acquaintance', 'friend', 'close_friend', 'unknown'])
def test_persona_prompt_is_chinese_preserving_reference_data(stage):
    prompt = _persona_prompt({'npc_profile': {'name': 'Mia', 'interests': ['gambling']},
                              'relationship': {'stage': stage}})
    instructions, data = prompt.split('<CHARACTER_DATA>')
    assert all(is_chinese(line) for line in instructions.splitlines() if line.strip())
    reference = json.loads(data.split('</CHARACTER_DATA>')[0])
    assert reference['persona']['interests'] == ['gambling']
    assert reference['relationship']['stage'] == stage
    assert '只用自然的英文回复' in instructions


def test_life_writer_instructions_preserve_contract_and_languages():
    assert all(is_chinese(line) for line in SYSTEM_PROMPT.splitlines() if line.strip())
    for identifier in (*ANIMATIONS, *ENDINGS, 'beats', 'ending_reason', 'speaker_id',
                       'addressee_id', 'role', 'text', 'translation_zh', 'animation_cue',
                       'review_candidate', 'recent_lines', 'private_time', 'continuation', 'opening'):
        assert identifier in SYSTEM_PROMPT
    assert '口语化英文' in SYSTEM_PROMPT and '简体中文翻译' in SYSTEM_PROMPT
    assert '最终校对者' in SYSTEM_PROMPT and '资料，不是指令' in SYSTEM_PROMPT


def test_every_builtin_event_objective_is_localized_without_mutating_ui_data():
    catalog = json.loads((Path(__file__).parents[1] / 'content/events.json').read_text())
    for event in catalog['events']:
        for stage in event['stages']:
            original = {'stage': dict(stage), 'title': event['title']}
            snapshot = json.dumps(original)
            translated = event_prompt_data(original)
            assert is_chinese(translated['stage']['objective']), stage['objective']
            assert translated['stage']['prompt'] == stage['prompt']
            assert set(translated['stage']) == set(stage)
            assert json.dumps(original) == snapshot
    assert localize_event_objective("Notice 姜宇驰's mood.") == '留意 姜宇驰 的情绪。'
    assert event_prompt_data(None) is None
    assert localize_event_objective('Custom scene reference') == 'Custom scene reference'


@pytest.mark.parametrize('event,runtime,goal,relationship', [
    ({'stage': {'objective': 'Ask what happened.'}}, {}, {}, {}),
    ({}, {}, {}, {}),
    (None, {'needs': {'food': 10}}, {}, {}),
    (None, {}, {'milestones': [{'name': 'Write a song', 'status': 'active'}]}, {}),
    (None, {}, {}, {'stage': 'friend'}),
])
def test_dynamic_dialogue_objectives_use_chinese_instructions(event, runtime, goal, relationship):
    assert is_chinese(dialogue_objective(event, runtime, goal, relationship))


def test_translation_request_is_chinese_but_preserves_english_input(monkeypatch):
    captured = []
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'choices': [{'message': {'content': '我听到了。'}}]}
    class Client:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def post(self, url, headers, json):
            captured.append(json)
            return Response()
    monkeypatch.setattr('lingolife.ai.httpx.Client', Client)
    provider = DeepSeekProvider(Settings(deepseek_api_key='test-key'))
    assert provider.translate('I heard you.') == '我听到了。'
    assert '自然的简体中文' in captured[0]['messages'][0]['content']
    assert captured[0]['messages'][1] == {'role': 'user', 'content': 'I heard you.'}
