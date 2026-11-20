package com.alok.jarvis;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;

import java.time.Instant;

@Entity
public class Conversation {
    @Id
    public String id;
    public String title;
    public Instant createdAt;
    public Instant updatedAt;
}
