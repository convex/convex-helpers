import React, { useState } from "react";
import { usePaginatedQuery } from "convex-helpers/react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import type { UsePaginatedQueryReturnType } from "convex/react";

// Styles object
const styles = {
  streamsExample: {
    padding: "20px",
    maxWidth: "1200px",
    margin: "0 auto",
  },
  userPanes: {
    display: "flex",
    gap: "20px",
    marginTop: "20px",
  },
  userPane: {
    flex: 1,
    border: "1px solid #ddd",
    borderRadius: "8px",
    padding: "20px",
    background: "#f9f9f9",
  },
  userHeader: {
    marginTop: 0,
    color: "#333",
    borderBottom: "2px solid #007bff",
    paddingBottom: "10px",
  },
  messageSection: {
    marginBottom: "20px",
    border: "1px solid #e0e0e0",
    borderRadius: "4px",
    padding: "15px",
    background: "white",
  },
  sectionHeader: {
    marginTop: 0,
    color: "#666",
    fontSize: "16px",
  },
  messageList: {
    maxHeight: "200px",
    overflowY: "auto" as const,
    border: "1px solid #eee",
    borderRadius: "4px",
    padding: "10px",
    background: "#fafafa",
  },
  messageItem: {
    marginBottom: "10px",
    padding: "8px",
    borderLeft: "3px solid #007bff",
    background: "white",
    borderRadius: "4px",
  },
  messageHeader: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "12px",
    color: "#666",
    marginBottom: "5px",
  },
  messageBody: {
    fontSize: "14px",
    color: "#333",
  },
  loadMoreBtn: {
    marginTop: "10px",
    padding: "5px 15px",
    background: "#007bff",
    color: "white",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
  },
  loading: {
    textAlign: "center" as const,
    color: "#666",
    fontStyle: "italic" as const,
    marginTop: "10px",
  },
  sendMessage: {
    border: "1px solid #e0e0e0",
    borderRadius: "4px",
    padding: "15px",
    background: "white",
  },
  messageInput: {
    display: "flex",
    gap: "10px",
  },
  input: {
    flex: 1,
    padding: "8px",
    border: "1px solid #ddd",
    borderRadius: "4px",
  },
  sendBtn: {
    padding: "8px 16px",
    background: "#28a745",
    color: "white",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
  },
  fromTo: {
    fontWeight: "bold" as const,
  },
  time: {
    color: "#999",
  },
};

// MessageList component that handles pagination results
interface MessageListProps {
  title: string;
  paginationResult: UsePaginatedQueryReturnType<
    typeof api.streamsExample.getInbox
  >;
}

const MessageList: React.FC<MessageListProps> = ({
  title,
  paginationResult,
}) => {
  const { results, status, loadMore } = paginationResult;

  return (
    <div style={styles.messageSection}>
      <h3 style={styles.sectionHeader}>{title}</h3>
      <div>Status: {status}</div>
      {status === "CanLoadMore" ? (
        <button
          onClick={() => loadMore(1)}
          style={styles.loadMoreBtn}
          onMouseOver={(e) => (e.currentTarget.style.background = "#0056b3")}
          onMouseOut={(e) => (e.currentTarget.style.background = "#007bff")}
        >
          Load More
        </button>
      ) : status === "Exhausted" ? (
        <div style={styles.loading}>No more messages</div>
      ) : status === "LoadingFirstPage" ? (
        <div style={styles.loading}>Loading first page...</div>
      ) : status === "LoadingMore" ? (
        <div style={styles.loading}>Loading more messages...</div>
      ) : null}
      <div style={styles.messageList}>
        {results
          .slice()
          .reverse()
          .map((message: Doc<"privateMessages">, index: number) => (
            <div key={index} style={styles.messageItem}>
              <div style={styles.messageHeader}>
                <span style={styles.fromTo}>From: {message.from}</span>
                <span style={styles.fromTo}>To: {message.to}</span>
                <span style={styles.time}>
                  {new Date(message.sentAt).toLocaleTimeString()}
                </span>
              </div>
              <div style={styles.messageBody}>{message.message}</div>
            </div>
          ))}
      </div>
    </div>
  );
};

// UserPane component that handles one user's messages and actions
interface UserPaneProps {
  userId: string;
  otherUserId: string;
  userName: string;
}

const UserPane: React.FC<UserPaneProps> = ({
  userId,
  otherUserId,
  userName,
}) => {
  const [message, setMessage] = useState("");
  const sendMessage = useMutation(api.streamsExample.sendMessage);

  // User's queries
  const inbox = usePaginatedQuery(
    api.streamsExample.getInbox,
    { id: userId },
    { initialNumItems: 2 },
  );

  const outbox = usePaginatedQuery(
    api.streamsExample.getOutbox,
    { id: userId },
    { initialNumItems: 2 },
  );

  const conversation = usePaginatedQuery(
    api.streamsExample.getMessagesBetween,
    { a: userId, b: otherUserId },
    { initialNumItems: 2 },
  );

  const handleSendMessage = async () => {
    if (message.trim()) {
      await sendMessage({
        from: userId,
        to: otherUserId,
        message: message,
      });
      setMessage("");
    }
  };

  return (
    <div style={styles.userPane}>
      <h2 style={styles.userHeader}>{userName}</h2>

      <MessageList title="Inbox" paginationResult={inbox} />

      <MessageList title="Outbox" paginationResult={outbox} />

      <MessageList
        title={`Conversation with ${otherUserId}`}
        paginationResult={conversation}
      />

      <div style={styles.sendMessage}>
        <h3 style={styles.sectionHeader}>Send Message to {otherUserId}</h3>
        <div style={styles.messageInput}>
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type your message..."
            onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
            style={styles.input}
          />
          <button
            onClick={handleSendMessage}
            style={styles.sendBtn}
            onMouseOver={(e) => (e.currentTarget.style.background = "#218838")}
            onMouseOut={(e) => (e.currentTarget.style.background = "#28a745")}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

// Main StreamsExample component
export function StreamsExample() {
  return (
    <div style={styles.streamsExample}>
      <h1>Streams Example - usePaginatedQuery Demo</h1>

      <div style={styles.userPanes}>
        <UserPane userId="UserA" otherUserId="UserB" userName="UserA" />
        <UserPane userId="UserB" otherUserId="UserA" userName="UserB" />
      </div>
    </div>
  );
}
