FROM homeassistant/home-assistant:stable

# Create default_config directory for pre-seeded files
RUN mkdir -p /default_config/custom_components

# Install HACS to default_config (will be copied to /config on first run)
RUN cd /default_config/custom_components && \
    wget -O hacs.zip https://github.com/hacs/integration/releases/latest/download/hacs.zip && \
    unzip hacs.zip -d hacs && \
    rm hacs.zip

# Install ha-bambulab integration (latest official release)
RUN cd /default_config/custom_components && \
    wget -O bambu_lab.zip https://github.com/greghesp/ha-bambulab/releases/latest/download/bambu_lab.zip && \
    unzip bambu_lab.zip -d bambu_lab && \
    rm bambu_lab.zip

# Copy configuration files
COPY configuration.yaml /default_config/configuration.yaml
COPY automations.yaml /default_config/automations.yaml

# Note: We don't pre-seed storage files because HA 2024+ validates them strictly.
# Users complete a one-time onboarding (create name/password), then trusted networks works.

# Copy startup script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
