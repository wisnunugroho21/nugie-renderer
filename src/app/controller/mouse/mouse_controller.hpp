#pragma once

#include "../../camera/camera.hpp"
#include "../../../vulkan/window/window.hpp"

namespace NugieApp {
  class MouseController
  {
    public:
      struct KeyMappings {
        int leftButton = GLFW_MOUSE_BUTTON_LEFT;
        int rightButton = GLFW_MOUSE_BUTTON_RIGHT;
      };

      glm::vec3 rotateInPlaceXZ(GLFWwindow* window, double dt, glm::vec3 currentCameraDirection, bool* isPressed);

      KeyMappings keymaps{};
      double lookSpeed{20.0};

      double lastDragged_x = 0;
      double lastDragged_y = 0;
      bool isFirstPressed = true;
  };

}