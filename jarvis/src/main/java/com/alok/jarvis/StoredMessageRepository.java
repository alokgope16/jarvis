package com.alok.jarvis;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface StoredMessageRepository extends JpaRepository<StoredMessage, Long> {
    List<StoredMessage> findByConversationIdOrderByIdAsc(String conversationId);

    void deleteByConversationId(String conversationId);
}