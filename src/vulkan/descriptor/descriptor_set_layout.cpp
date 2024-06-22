#include "descriptor_set_layout.hpp"

// std
#include <cassert>
#include <stdexcept>

namespace NugieVulkan {
    // *************** Descriptor Set Layout Builder *********************

    DescriptorSetLayout::Builder &DescriptorSetLayout::Builder::addBinding(
            uint32_t binding,
            VkDescriptorType descriptorType,
            VkShaderStageFlags stageFlags,
            uint32_t count) 
    {
        assert(this->bindings.count(binding) == 0 && "Binding already in use");

        VkDescriptorSetLayoutBinding layoutBinding{};
        layoutBinding.binding = binding;
        layoutBinding.descriptorType = descriptorType;
        layoutBinding.descriptorCount = count;
        layoutBinding.stageFlags = stageFlags;

        this->bindings[binding] = layoutBinding;
        return *this;
    }

    DescriptorSetLayout::Builder &DescriptorSetLayout::Builder::addFlag(
            uint32_t binding,
            VkDescriptorBindingFlags flag) 
    {
        assert(this->flags.count(binding) == 0 && "Flag already in use");

        this->flags[binding] = flag;
        return *this;
    }

    DescriptorSetLayout *DescriptorSetLayout::Builder::build() const {
        return new DescriptorSetLayout(this->device, this->bindings);
    }

    // *************** Descriptor Set Layout *********************

    DescriptorSetLayout::DescriptorSetLayout(
            Device *device, std::unordered_map<uint32_t, VkDescriptorSetLayoutBinding> bindings)
            : device{device}, bindings{bindings} 
    {
        std::vector<VkDescriptorSetLayoutBinding> setLayoutBindings{};
        for (auto &kv: this->bindings) {
            setLayoutBindings.push_back(kv.second);
        }

        VkDescriptorSetLayoutCreateInfo descriptorSetLayoutInfo{};
        descriptorSetLayoutInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        descriptorSetLayoutInfo.bindingCount = static_cast<uint32_t>(setLayoutBindings.size());
        descriptorSetLayoutInfo.pBindings = setLayoutBindings.data();

        if (this->flags.size() > 0) {
            std::vector<VkDescriptorBindingFlags> setLayoutFlags{};
            for (auto &kv: this->bindings) {
                if (this->flags.count(kv.first) == 0) {
                    setLayoutFlags.push_back(0);
                } else {
                    setLayoutFlags.push_back(this->flags[kv.first]);
                }
            }

            VkDescriptorSetLayoutBindingFlagsCreateInfo bindingFlags{};
            bindingFlags.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_BINDING_FLAGS_CREATE_INFO;
            bindingFlags.bindingCount = static_cast<uint32_t>(setLayoutFlags.size());
            bindingFlags.pBindingFlags = setLayoutFlags.data();

            descriptorSetLayoutInfo.pNext = &bindingFlags;
        }

        if (vkCreateDescriptorSetLayout(
                this->device->getLogicalDevice(),
                &descriptorSetLayoutInfo,
                nullptr,
                &this->descriptorSetLayout) != VK_SUCCESS) {
            throw std::runtime_error("failed to create descriptor set layout!");
        }
    }

    DescriptorSetLayout::~DescriptorSetLayout() {
        vkDestroyDescriptorSetLayout(this->device->getLogicalDevice(), descriptorSetLayout, nullptr);
    }
}