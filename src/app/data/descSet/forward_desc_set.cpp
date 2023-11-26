#include "forward_desc_set.hpp"
#include "../../../vulkan/descriptor/descriptor_writer.hpp"

namespace NugieApp {
  ForwardDescSet::ForwardDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool,
		std::vector<VkDescriptorBufferInfo> uniformBufferInfo[2], VkDescriptorBufferInfo modelsInfo[2], VkDescriptorImageInfo texturesInfo[1]) 
	{
		this->createDescriptor(device, descriptorPool, uniformBufferInfo, modelsInfo, texturesInfo);
  }

	ForwardDescSet::~ForwardDescSet() {
		if (this->descSetLayout != nullptr) delete this->descSetLayout;
	}

  void ForwardDescSet::createDescriptor(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool,
		std::vector<VkDescriptorBufferInfo> uniformBufferInfo[2], VkDescriptorBufferInfo modelsInfo[2], 
		VkDescriptorImageInfo texturesInfo[1]) 
	{
    this->descSetLayout = 
			NugieVulkan::DescriptorSetLayout::Builder(device)
				.addBinding(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_VERTEX_BIT)
				.addBinding(1, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_VERTEX_BIT)
				.addBinding(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_VERTEX_BIT)
				.addBinding(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(4, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addFlag(4, VK_DESCRIPTOR_BINDING_VARIABLE_DESCRIPTOR_COUNT_BIT | VK_DESCRIPTOR_BINDING_PARTIALLY_BOUND_BIT)
				.build();
		
	this->descriptorSets.clear();
		for (int i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			VkDescriptorSet descSet;

			auto x = NugieVulkan::DescriptorWriter(device, this->descSetLayout, descriptorPool)
				.writeBuffer(0, uniformBufferInfo[0][i])
				.writeBuffer(1, uniformBufferInfo[1][i])
				.writeBuffer(2, modelsInfo[0])
				.writeBuffer(3, modelsInfo[1])
				.writeImage(4, texturesInfo[0])
				.build(&descSet);
			
			this->descriptorSets.emplace_back(descSet);
		}
  }
}