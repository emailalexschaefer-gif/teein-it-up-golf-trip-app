# Moments — Sprint 6 Opening Feature (vision only, not built)

Status: **captured, not implemented**, per explicit instruction to treat
this as Sprint 6's opening feature rather than squeeze it into a QA pass.

## Concept

Chat gains two message types: **Message** and **Moment 📷**.

Moment flow: take photo → choose photo → optional caption → automatically
stores event, round, hole, player, group, timestamp, caption, image.

Appears automatically in:
- Chat
- My Round → My Moments
- Organiser My HQ → Event Story

## Relationship to existing groundwork

This connects directly to `docs/MY_GOLF_ARCHITECTURE.md` (written earlier
this project) — that document already describes a future `moments` table
shape (id, trip_id, round_id, hole_number, uploader_profile_id,
media_type, storage_path, caption, captured_at, plus a separate
`moment_tags` table for player tagging) and notes the avatar storage
bucket's RLS pattern (owner-scoped folder, public read) as the template a
`moments` bucket would follow. That analysis still holds — worth reading
together with this note when Sprint 6 starts.

The chat message-type infrastructure already exists and is directly
reusable: `event_messages.message_type` already distinguishes
`chat_message` from `announcement`/`group_notification`/
`player_notification`. Adding a `moment` type (or a `has_image`/
`moment_id` reference column) to that same enum, rather than inventing a
parallel messaging concept, would keep "Moments appear in Chat" simple —
they'd literally be chat messages with an attached image, not a separate
feed that needs its own display logic bolted onto Chat.

"My Round → My Moments" and "My HQ → Event Story" are new surfaces (My
Round and My HQ both already exist and have room for a new section each)
rather than new top-level destinations.
