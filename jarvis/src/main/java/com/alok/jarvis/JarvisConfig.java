package com.alok.jarvis;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class JarvisConfig {

    @Bean
    ChatClient chatClient(ChatClient.Builder builder) {
        return builder
                .defaultSystem("""
                You are Jarvis, a helpful personal AI assistant.
                Answer in 2 to 3 short sentences unless the user asks for detail.
                Do not use bullet points, markdown, or emojis,
                because your answers will be spoken out loud.
                If you do not know something, say so honestly.
                """)
                .build();
    }
}