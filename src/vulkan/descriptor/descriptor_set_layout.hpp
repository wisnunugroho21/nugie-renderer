#pragma once
 
#include "../device/device.hpp"
 
// std
#include <memory>
#include <unordered_map>
#include <vector>
 
namespace NugieVulkan {
  class DescriptorSetLayout {
    public:
      class Builder {
      public:
        Builder(Device* device) : device{device} {}
    
        Builder& addBinding(
          uint32_t binding,
          VkDescriptorType descriptorType,
          VkShaderStageFlags stageFlags,
          uint32_t count = 1
        );
        DescriptorSetLayout* build() const;
    
      private:
        Device* device;
        std::unordered_map<uint32_t, VkDescriptorSetLayoutBinding> bindings{};
      };
    
      DescriptorSetLayout(Device* device, std::unordered_map<uint32_t, VkDescriptorSetLayoutBinding> bindings);
      ~DescriptorSetLayout();
    
      VkDescriptorSetLayout getDescriptorSetLayout() const { return this->descriptorSetLayout; }
      std::unordered_map<uint32_t, VkDescriptorSetLayoutBinding> getBindings() const { return this->bindings; }
    
    private:
      Device* device;
      VkDescriptorSetLayout descriptorSetLayout;
      std::unordered_map<uint32_t, VkDescriptorSetLayoutBinding> bindings;
  };
}