#pragma once

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE

#include <glm/glm.hpp>

namespace NugieApp {
    struct CameraTransformation {
        alignas(16) glm::vec3 origin{0.0f};
        alignas(16) glm::vec3 direction{0.0f};
    };

    struct CameraRay {
        alignas(16) glm::vec3 origin{0.0f};
        alignas(16) glm::vec3 horizontal{0.0f};
        alignas(16) glm::vec3 vertical{0.0f};
        alignas(16) glm::vec3 lowerLeftCorner{0.0f};
    };

    class Camera {
    public:
        Camera(uint32_t width, uint32_t height);

        CameraRay getCameraRay() const { return this->cameraRay; }

        CameraTransformation getCameraTransformation() const { return this->cameraTransformation; }

        glm::vec3 getPosition() const { return this->position; }

        glm::vec3 getDirection() const { return this->direction; }

        glm::vec2 getRotation() const { return this->rotation; }

        glm::mat4 getProjectionMatrix() const { return this->projectionMatrix; }

        glm::mat4 getViewMatrix() const { return this->viewMatrix; }

        glm::mat4 getInverseViewMatrix() const { return this->inverseViewMatrix; }

        void setAspect(float aspectRatio);

        void setOrthographicProjection(float left, float right, float top, float bottom, float near, float far);
        void setPerspectiveProjection(float fovy, float aspectRatio, float near, float far);

        void setViewDirection(glm::vec3 position, glm::vec3 direction, glm::vec3 vup = glm::vec3{0.0f, 1.0f, 0.0f});

        void setViewTransformation(CameraTransformation cameraTransformation, glm::vec3 vup = glm::vec3{0.0f, 1.0f, 0.0f});

        void setViewTarget(glm::vec3 position, glm::vec3 target, glm::vec3 vup = glm::vec3{0.0f, 1.0f, 0.0f});        

    private:
        CameraRay cameraRay;
        CameraTransformation cameraTransformation;

        uint32_t width, height;

        glm::mat4 projectionMatrix{1.0f};
        glm::mat4 viewMatrix{1.0f};
        glm::mat4 inverseViewMatrix{1.0f};

        glm::vec3 position, direction;
        glm::vec2 rotation;

        float fovy, aspectRatio, near, far;
    };
} // namespace nugiEngine
