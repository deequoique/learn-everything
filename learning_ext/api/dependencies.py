from __future__ import annotations

from collections.abc import Callable, Iterator

from fastapi import Request
from sqlmodel import Session, select

from learning_ext.api.errors import not_found
from learning_ext.db.models import Card, KnowledgeNode, LearningProject

CURRENT_USER_ID = "default"


def default_session_factory() -> Session:
    from ktem.db.engine import engine

    return Session(engine)


def get_session(request: Request) -> Iterator[Session]:
    factory: Callable[[], Session] = request.app.state.session_factory
    with factory() as session:
        yield session


def require_project(session: Session, project_id: int) -> LearningProject:
    project = session.exec(
        select(LearningProject)
        .where(LearningProject.id == project_id)
        .where(LearningProject.user_id == CURRENT_USER_ID)
    ).first()
    if project is None:
        raise not_found()
    return project


def require_node(session: Session, node_id: int) -> KnowledgeNode:
    node = session.exec(
        select(KnowledgeNode)
        .join(LearningProject, LearningProject.id == KnowledgeNode.project_id)
        .where(KnowledgeNode.id == node_id)
        .where(LearningProject.user_id == CURRENT_USER_ID)
    ).first()
    if node is None:
        raise not_found()
    return node


def require_card(session: Session, card_id: int) -> Card:
    card = session.exec(
        select(Card).where(Card.id == card_id).where(Card.user_id == CURRENT_USER_ID)
    ).first()
    if card is None:
        raise not_found()
    return card
