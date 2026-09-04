from __future__ import annotations

from lingolife.chat_rules import settle_chat_semantics
from lingolife.models import EnglishFeedback, LearningEvidence


def _feedback(understandable: bool = True) -> EnglishFeedback:
    return EnglishFeedback(
        is_understandable=understandable,
        corrected_text="I understand how you feel.",
        tip="Keep going.",
    )


def test_chat_numbers_are_derived_from_semantics_not_provider_numbers():
    settlement = settle_chat_semantics(
        semantic_signals=["empathy", "reassurance"],
        english_feedback=_feedback(),
        learning_evidence=[],
    )
    assert settlement.relationship_change == 3
    assert settlement.mood_change == 3
    assert settlement.english_xp_change == 1


def test_language_errors_do_not_cancel_an_understandable_caring_intent():
    settlement = settle_chat_semantics(
        semantic_signals=["empathy"],
        english_feedback=_feedback(),
        learning_evidence=[
            LearningEvidence(target_id="grammar.past_simple", outcome="error"),
        ],
    )
    assert settlement.relationship_change > 0
    assert settlement.mood_change > 0
    assert settlement.english_xp_change == 1


def test_unintelligible_input_never_awards_xp_but_does_not_invent_a_penalty():
    settlement = settle_chat_semantics(
        semantic_signals=[],
        english_feedback=_feedback(False),
        learning_evidence=[
            LearningEvidence(target_id="grammar.questions", outcome="success"),
        ],
    )
    assert settlement.relationship_change == 0
    assert settlement.mood_change == 0
    assert settlement.english_xp_change == 0


def test_duplicate_learning_evidence_cannot_multiply_xp():
    evidence = LearningEvidence(target_id="intent.empathy", outcome="success")
    settlement = settle_chat_semantics(
        semantic_signals=["empathy", "empathy", "unknown"],
        english_feedback=_feedback(),
        learning_evidence=[evidence, evidence, evidence],
    )
    assert settlement.relationship_change == 2
    assert settlement.english_xp_change == 3
