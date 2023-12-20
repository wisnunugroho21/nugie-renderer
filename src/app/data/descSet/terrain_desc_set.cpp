#include "terrain_desc_set.hpp"
#include "../../../vulkan/descriptor/descriptor_writer.hpp"

namespace NugieApp {
  TerrainDescSet::TerrainDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool,
		std::vector<VkDescriptorBufferInfo> uniformBufferInfo[1])
		: device{device}, descriptorPool{descriptorPool} 
	{
		this->createDescriptorLayout();
		this->createDescriptorSet(uniformBufferInfo);
  }

	TerrainDescSet::~TerrainDescSet() {
		if (this->descSetLayout != nullptr) delete this->descSetLayout;
	}

	void TerrainDescSet::createDescriptorLayout() {
		this->descSetLayout = 
			NugieVulkan::DescriptorSetLayout::Builder(this->device)
				.addBinding(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_VERTEX_BIT)
				.build();
	}

  void TerrainDescSet::createDescriptorSet(std::vector<VkDescriptorBufferInfo> uniformBufferInfo[1]) 
	{	
		this->descriptorSets.clear();
		for (int i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			VkDescriptorSet descSet;

			NugieVulkan::DescriptorWriter(this->device, this->descSetLayout, this->descriptorPool)
				.writeBuffer(0, uniformBufferInfo[0][i])
				.build(&descSet);
			
			this->descriptorSets.emplace_back(descSet);
		}
  }

	void TerrainDescSet::overwrite(std::vector<VkDescriptorBufferInfo> uniformBufferInfo[1]) 
	{
		for (size_t i = 0; i < this->descriptorSets.size(); i++) {
			NugieVulkan::DescriptorWriter(this->device, this->descSetLayout, this->descriptorPool)
				.writeBuffer(0, uniformBufferInfo[0][i])
				.overwrite(&this->descriptorSets[i]);
		}
	}
}