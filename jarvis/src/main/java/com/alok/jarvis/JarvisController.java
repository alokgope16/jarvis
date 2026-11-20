package com.alok.jarvis;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.prompt.ChatOptions;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Flux;
import reactor.core.scheduler.Schedulers;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@RestController
@RequestMapping("/api")
@CrossOrigin
public class JarvisController {

    private static final int MAX_HISTORY = 10;   // last 10 messages are sent to the model

    private final ChatClient chatClient;
    private final ConversationRepository conversations;
    private final StoredMessageRepository messages;

    @Value("${jarvis.models}")
    private List<String> models;

    public JarvisController(ChatClient chatClient,
                            ConversationRepository conversations,
                            StoredMessageRepository messages) {
        this.chatClient = chatClient;
        this.conversations = conversations;
        this.messages = messages;
    }

    public record ChatSummary(String id, String title, String updatedAt) {}
    public record MessageDto(String role, String text) {}

    /* ---------- chat ---------- */

    @GetMapping(value = "/chat", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<String> chat(
            @RequestParam String message,
            @RequestParam(defaultValue = "llama3.2:3b") String model,
            @RequestParam String sessionId) {

        List<Message> history = loadHistory(sessionId);
        saveMessage(sessionId, "user", message);

        StringBuilder reply = new StringBuilder();
        return chatClient.prompt()
                .messages(history)
                .user(message)
                .options(ChatOptions.builder().model(model))
                .stream()
                .content()
                .doOnNext(reply::append)
                .doFinally(signal -> Schedulers.boundedElastic().schedule(() -> {
                    if (!reply.isEmpty()) saveMessage(sessionId, "assistant", reply.toString());
                }));
    }

    @GetMapping("/models")
    public List<String> models() {
        return models;
    }

    /* ---------- chat history ---------- */

    @GetMapping("/chats")
    public List<ChatSummary> chats() {
        return conversations.findAllByOrderByUpdatedAtDesc().stream()
                .map(c -> new ChatSummary(c.id, c.title, c.updatedAt.toString()))
                .toList();
    }

    @GetMapping("/chats/{id}")
    public List<MessageDto> chatMessages(@PathVariable String id) {
        return messages.findByConversationIdOrderByIdAsc(id).stream()
                .map(m -> new MessageDto(m.sender, m.body))
                .toList();
    }

    @DeleteMapping("/chats/{id}")
    @Transactional
    public void deleteChat(@PathVariable String id) {
        messages.deleteByConversationId(id);
        conversations.deleteById(id);
    }

    /* ---------- helpers ---------- */

    private List<Message> loadHistory(String conversationId) {
        List<StoredMessage> all = messages.findByConversationIdOrderByIdAsc(conversationId);
        List<Message> out = new ArrayList<>();
        for (StoredMessage m : all.subList(Math.max(0, all.size() - MAX_HISTORY), all.size())) {
            out.add("user".equals(m.sender) ? new UserMessage(m.body) : new AssistantMessage(m.body));
        }
        return out;
    }

    private void saveMessage(String conversationId, String sender, String body) {
        Instant now = Instant.now();
        Conversation c = conversations.findById(conversationId).orElseGet(() -> {
            Conversation n = new Conversation();
            n.id = conversationId;
            String clean = body.strip().replaceAll("\\s+", " ");
            n.title = clean.length() > 40 ? clean.substring(0, 40) + "…" : clean;
            n.createdAt = now;
            return n;
        });
        c.updatedAt = now;
        conversations.save(c);

        StoredMessage m = new StoredMessage();
        m.conversationId = conversationId;
        m.sender = sender;
        m.body = body;
        m.createdAt = now;
        messages.save(m);
    }
}