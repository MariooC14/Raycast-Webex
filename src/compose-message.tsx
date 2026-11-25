import { Action, ActionPanel, Form, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { useRef, useState } from "react";
import { ManageConnectionAction } from "./connection";
import { errorMessage, Recipient, WebexClient } from "./webex";

export function ComposeMessage({
  webex,
  recipient,
  onSent,
}: Readonly<{
  webex: WebexClient;
  recipient: Recipient;
  onSent?: () => void;
}>) {
  const { pop } = useNavigation();
  const busy = useRef(false);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string>();
  const [sendError, setSendError] = useState<string>();

  async function submit() {
    if (busy.current) return;
    if (!draft.trim()) {
      setError("Enter a message.");
      return;
    }
    busy.current = true;
    setIsSending(true);
    setSendError(undefined);
    try {
      await webex.sendMessage(recipient, draft);
    } catch (error) {
      setSendError(errorMessage(error));
      setIsSending(false);
      busy.current = false;
      return;
    }
    onSent?.();
    pop();
    await showToast(Toast.Style.Success, "Message Sent");
  }

  return (
    <Form
      navigationTitle="Send Webex Message"
      isLoading={isSending}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Send Message" icon={Icon.Message} onSubmit={submit} />
          {sendError && <ManageConnectionAction />}
        </ActionPanel>
      }
    >
      <Form.Description title="To" text={recipient.name} />
      <Form.TextArea
        id="message"
        title="Message"
        value={draft}
        error={error}
        onChange={(value) => {
          setDraft(value);
          setError(undefined);
        }}
        autoFocus
      />
      {sendError && <Form.Description text={sendError} />}
    </Form>
  );
}
