# 08. Content & Voice

**Words are UI. Tone, microcopy, naming, formatting.**

---

## Purpose

Copy is not an afterthought. **Words are interface elements** that:

- Guide users through tasks
- Communicate system state
- Build trust through transparency
- Reflect brand personality

**Bad copy = confused users. Good copy = invisible guidance.**

---

## Voice Principles

### 1. Clear Over Clever

**Priority**: Understanding > creativity

❌ **Bad**: "Oops! Gremlins in the system 😅"
✅ **Good**: "Upload failed. Check your connection and try again."

---

### 2. Professional Not Corporate

**Tone**: Helpful colleague, not HR department

❌ **Corporate**: "Pursuant to your request, the system has processed your submission."
✅ **Professional**: "Your content has been published."

---

### 3. Direct Not Wordy

**Rule**: Remove every unnecessary word

❌ **Wordy**: "You can click on the button below to proceed with publishing your content."
✅ **Direct**: "Publish your content"

---

### 4. Active Not Passive

**Use active voice**: Subject does the action

❌ **Passive**: "Your upload has been completed by the system."
✅ **Active**: "Upload complete."

---

## Tone Variations by Context

### Success States

**Tone**: Confident, brief

- ✅ "Content published"
- ✅ "Changes saved"
- ✅ "Upload complete"

**Not**:
- ❌ "Yay! Success! 🎉"
- ❌ "Awesome job!"

---

### Error States

**Tone**: Calm, helpful, actionable

**Structure**: [What happened] + [Why] + [How to fix]

✅ **Good**:
```
"Upload failed: File exceeds 5GB limit.
Try compressing or splitting into parts."
```

❌ **Bad**:
```
"Error 0x4A2B"  (unhelpful)
"Upload failed" (no guidance)
"Oops!"         (unprofessional)
```

---

### Warning States

**Tone**: Cautious, informative

✅ **Good**:
```
"Deleting this content is permanent.
Customers who purchased will lose access."
```

❌ **Bad**:
```
"Are you sure?" (vague)
"This action cannot be undone" (obvious, unhelpful)
```

---

### Onboarding

**Tone**: Welcoming, instructional

✅ **Good**:
```
"Welcome to Codex
Upload your first video to get started"
```

❌ **Bad**:
```
"Hey there! Ready to become a creator superstar? Let's do this! 🚀"
```

---

## Microcopy Standards

### Button Labels

**Rule**: Start with verb

✅ **Good**:
- "Save Changes"
- "Publish Content"
- "Delete Account"

❌ **Bad**:
- "Save"           (ambiguous context)
- "OK"             (meaningless)
- "Click Here"     (redundant)

---

### Form Labels

**Rule**: Question or noun phrase

✅ **Good**:
- "Content Title"
- "What's your email?"
- "Choose a price"

❌ **Bad**:
- "Title:"         (colon unnecessary)
- "Email Address*" (asterisk handled separately)

---

### Placeholder Text

**Rule**: Example, not instruction (label is instruction)

✅ **Good**:
- Placeholder: "My Course Title"
- Label: "Content Title"

❌ **Bad**:
- Placeholder: "Enter title here"

---

### Error Messages

**Format**: `[Field] [problem]. [Solution]`

✅ **Good**:
```
"Email is invalid. Use format: name@example.com"
"Password too short. Use at least 8 characters"
"Title required. Enter a title to continue"
```

❌ **Bad**:
```
"Invalid input"
"Error"
"Field is required"
```

---

### Empty States

**Format**: [What's missing] + [Why it matters] + [Action]

✅ **Good**:
```
"No content yet
Upload videos to start earning

[Upload Content]
```

❌ **Bad**:
```
"Nothing here"
```

---

## Naming Conventions

### Features

**Pattern**: Noun or verb phrase (clear, specific)

✅ **Good**:
- "Content Library"
- "Revenue Dashboard"
- "Upload Manager"

❌ **Bad**:
- "Stuff"
- "My Things"
- "Creator Portal" (too vague)

---

### Actions

**Pattern**: Verb + object

✅ **Good**:
- "Edit Settings"
- "View Analytics"
- "Download Report"

❌ **Bad**:
- "Manage" (vague)
- "Go"     (meaningless)

---

### Navigation

**Pattern**: Plural nouns or "My [thing]"

✅ **Good**:
- "Dashboard"
- "Content"
- "Analytics"
- "Settings"

❌ **Bad**:
- "Home" (ambiguous)
- "Stuff"

---

## Formatting Rules

### Capitalization

**Title Case**: Page titles, headings, buttons

```
"Upload Your Content"
"Revenue Dashboard"
```

**Sentence case**: Body text, labels, descriptions

```
"Choose a title for your content"
"This will be visible to customers"
```

**ALL CAPS**: Never (accessibility issue, feels aggressive)

---

### Punctuation

**Periods**: Complete sentences only

```
✅ "Your content has been published."
❌ "Publish Content."  (button label, not a sentence)
```

**Exclamation marks**: Never (wrong tone)

```
❌ "Success!"
✅ "Content published"
```

**Question marks**: Yes, when asking questions

```
✅ "Delete this content?"
✅ "What's your email?"
```

---

### Numbers

**Format**:
- **< 10**: Spell out ("three videos")
- **≥ 10**: Numerals ("12 videos")
- **Large**: Abbreviate ("1.2K views", "$2.5M revenue")

**Currency**: Always prefix with symbol

```
✅ "$29.99"
❌ "29.99 USD"
```

**Percentages**: No space before %

```
✅ "10% platform fee"
❌ "10 %"
```

---

## Content Length Constraints

**Guideline**:

```
Page title:        40 characters max
Button label:      25 characters max
Toast message:     60 characters max
Error message:     120 characters max
Empty state:       200 characters max
Help text:         No limit (but keep concise)
```

**Why?** Mobile screens, internationalization (text expands 30-40%)

---

## Internationalization

### Avoid

- Idioms ("piece of cake")
- Slang ("awesome", "cool")
- Cultural references (US-centric)
- Humor (doesn't translate)

### Use

- Simple words (international English)
- Active voice (easier to translate)
- Complete sentences (context for translators)

---

## Voice Checklist

Every piece of copy must pass:

- [ ] **Clear**: Can user understand without explanation?
- [ ] **Professional**: Appropriate tone for context?
- [ ] **Direct**: No unnecessary words?
- [ ] **Active**: Subject does the action?
- [ ] **Actionable**: Does user know what to do next?
- [ ] **Accessible**: Simple language, no jargon?

---

## Examples

### Good: Upload Success

```
Title:  "Upload Complete"
Body:   "Your video is processing. You'll be notified when it's ready."
Action: "View Content"
```

**Why it works**:
- Clear state (complete)
- Sets expectation (processing, notification)
- Next action obvious

---

### Bad: Generic Error

```
Title:  "Error"
Body:   "Something went wrong"
Action: "OK"
```

**Why it fails**:
- No information (what error?)
- No guidance (how to fix?)
- Unhelpful action (OK doesn't solve anything)

---

### Good: Destructive Confirmation

```
Title:  "Delete This Content?"
Body:   "This will permanently delete 'Course Title' and revoke customer access. This cannot be undone."
Action: "Cancel" / "Delete Content"
```

**Why it works**:
- Clear consequence
- Specific (shows title)
- Escape hatch (cancel)
- Action label matches consequence

---

## Living Document

Voice evolves with brand. Changes require:

1. Examples of new tone
2. User testing (comprehension)
3. Update to this guide

**Change log**:

| Date | Change | Reasoning |
|------|--------|-----------|
| 2026-01-01 | Initial voice guide | Foundation |

---

Next: [09. Accessibility & Inclusion →](../09-accessibility/README.md)
