package com.alok.jarvis;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;

import java.time.Instant;

@Entity
public class StoredMessage {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(nullable = false)
    public String conversationId;

    @Column(nullable = false)
    public String sender;            // "user" or "assistant"

    @Column(length = 32000)
    public String body;

    public Instant createdAt;
}
